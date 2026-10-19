//! The document's markups, with undo and redo.
//!
//! Every edit is a list of changes (a markup before and after; none before is an add, none after
//! a delete), so one undo reverts a whole drag or a whole delete of several markups.

use crate::Markup;

#[derive(Clone, Debug)]
struct Change {
    /// Where the markup sits in the list (where a deleted one goes back).
    pos: usize,
    before: Option<Markup>,
    after: Option<Markup>,
}

#[derive(Default)]
pub struct Store {
    markups: Vec<Markup>,
    undo: Vec<Vec<Change>>,
    redo: Vec<Vec<Change>>,
    next_seq: u64,
    /// What the last undo step was (see [`Store::update_coalesced`]).
    last_key: Option<String>,
    /// Edits since the last save.
    pub dirty: bool,
    /// Annotations imported per page as (page, /Annots index): saving removes the ones whose
    /// markup was deleted.
    pub imported: Vec<(usize, u32)>,
}

impl Store {
    pub fn new() -> Self {
        Self {
            next_seq: 1,
            ..Default::default()
        }
    }

    pub fn all(&self) -> &[Markup] {
        &self.markups
    }

    pub fn get(&self, id: &str) -> Option<&Markup> {
        self.markups.iter().find(|m| m.id == id)
    }

    pub fn on_page(&self, page: usize) -> impl Iterator<Item = &Markup> {
        self.markups.iter().filter(move |m| m.page_index == page)
    }

    /// Loads markups read from the file (no undo step, not dirty).
    pub fn load(&mut self, markups: Vec<Markup>, imported: Vec<(usize, u32)>) {
        for m in &markups {
            self.next_seq = self.next_seq.max(m.seq.unwrap_or(0) + 1);
        }
        self.markups = markups;
        self.imported = imported;
        self.undo.clear();
        self.redo.clear();
        self.dirty = false;
    }

    /// Adds a markup, numbering it. Returns its id.
    pub fn add(&mut self, mut m: Markup) -> String {
        if m.seq.is_none() {
            m.seq = Some(self.next_seq);
        }
        self.next_seq = self.next_seq.max(m.seq.unwrap_or(0) + 1);
        let id = m.id.clone();
        let pos = self.markups.len();
        self.commit(vec![Change {
            pos,
            before: None,
            after: Some(m),
        }]);
        id
    }

    /// Adds several markups as one undo step (paste).
    pub fn add_all(&mut self, ms: Vec<Markup>) -> Vec<String> {
        let mut changes = Vec::new();
        let mut ids = Vec::new();
        for (i, mut m) in ms.into_iter().enumerate() {
            m.seq = Some(self.next_seq);
            self.next_seq += 1;
            ids.push(m.id.clone());
            changes.push(Change {
                pos: self.markups.len() + i,
                before: None,
                after: Some(m),
            });
        }
        self.commit(changes);
        ids
    }

    /// Changes markups as one undo step. `f` gets each one (unlocked ones only); those it leaves
    /// as they were are not part of the step.
    pub fn update(&mut self, ids: &[String], mut f: impl FnMut(&mut Markup)) {
        let now = crate::now_ms();
        let mut changes = Vec::new();
        for (pos, m) in self.markups.iter().enumerate() {
            if !ids.contains(&m.id) || m.is_locked() {
                continue;
            }
            let mut n = m.clone();
            f(&mut n);
            if n != *m {
                n.modified_at = now;
                changes.push(Change {
                    pos,
                    before: Some(m.clone()),
                    after: Some(n),
                });
            }
        }
        self.commit(changes);
    }

    /// Like [`Store::update`], but merged into the last undo step when that was the same kind of
    /// change (`key`) to the same markups: dragging a slider is one step, not a hundred.
    pub fn update_coalesced(&mut self, ids: &[String], key: &str, f: impl FnMut(&mut Markup)) {
        let key = format!("{key}:{}", ids.join(","));
        let merge = self.last_key.as_deref() == Some(key.as_str()) && self.redo.is_empty();
        let before = merge.then(|| self.undo.pop()).flatten();
        let steps = self.undo.len();
        self.update(ids, f);
        if let Some(prev) = before {
            if self.undo.len() > steps {
                let mut now = self.undo.pop().unwrap();
                // Keep each markup's state from before the first change.
                for c in &mut now {
                    let id = c.after.as_ref().map(|m| &m.id);
                    if let Some(p) = prev.iter().find(|p| p.after.as_ref().map(|m| &m.id) == id) {
                        c.before = p.before.clone();
                    }
                }
                self.undo.push(now);
            } else {
                self.undo.push(prev);
            }
        }
        self.last_key = Some(key);
    }

    /// Changes a markup even when locked (locking itself, status and comments).
    pub fn update_any(&mut self, id: &str, f: impl FnOnce(&mut Markup)) {
        let Some(pos) = self.markups.iter().position(|m| m.id == id) else {
            return;
        };
        let mut n = self.markups[pos].clone();
        f(&mut n);
        if n != self.markups[pos] {
            n.modified_at = crate::now_ms();
            let before = Some(self.markups[pos].clone());
            self.commit(vec![Change {
                pos,
                before,
                after: Some(n),
            }]);
        }
    }

    /// Deletes markups (not locked ones) as one undo step.
    pub fn remove(&mut self, ids: &[String]) {
        let changes: Vec<Change> = self
            .markups
            .iter()
            .enumerate()
            .filter(|(_, m)| ids.contains(&m.id) && !m.is_locked())
            .map(|(pos, m)| Change {
                pos,
                before: Some(m.clone()),
                after: None,
            })
            .collect();
        self.commit(changes);
    }

    fn commit(&mut self, changes: Vec<Change>) {
        if changes.is_empty() {
            return;
        }
        apply(&mut self.markups, &changes, false);
        self.last_key = None;
        self.undo.push(changes);
        self.redo.clear();
        self.dirty = true;
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    pub fn undo(&mut self) -> bool {
        self.last_key = None;
        let Some(c) = self.undo.pop() else { return false };
        apply(&mut self.markups, &c, true);
        self.redo.push(c);
        self.dirty = true;
        true
    }

    pub fn redo(&mut self) -> bool {
        let Some(c) = self.redo.pop() else { return false };
        apply(&mut self.markups, &c, false);
        self.undo.push(c);
        self.dirty = true;
        true
    }
}

/// Applies changes forwards, or backwards for undo. Deletes go from the back so positions hold;
/// adds go from the front.
fn apply(list: &mut Vec<Markup>, changes: &[Change], reverse: bool) {
    let flip = |c: &Change| {
        if reverse {
            (c.after.clone(), c.before.clone())
        } else {
            (c.before.clone(), c.after.clone())
        }
    };
    // Replacements.
    for c in changes {
        if let (Some(from), Some(to)) = flip(c)
            && let Some(m) = list.iter_mut().find(|m| m.id == from.id)
        {
            *m = to;
        }
    }
    // Removals, last position first.
    let mut removals: Vec<&Change> = changes.iter().filter(|c| matches!(flip(c), (Some(_), None))).collect();
    removals.sort_by_key(|c| std::cmp::Reverse(c.pos));
    for c in removals {
        let id = &flip(c).0.unwrap().id;
        if let Some(i) = list.iter().position(|m| &m.id == id) {
            list.remove(i);
        }
    }
    // Insertions, first position first.
    let mut adds: Vec<&Change> = changes.iter().filter(|c| matches!(flip(c), (None, Some(_)))).collect();
    adds.sort_by_key(|c| c.pos);
    for c in adds {
        let m = flip(c).1.unwrap();
        list.insert(c.pos.min(list.len()), m);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Markup, RECT, TEXT};

    fn m(kind: &str) -> Markup {
        Markup::new(kind, 0, vec![[0.0, 0.0], [10.0, 10.0]], "me")
    }

    #[test]
    fn add_move_delete_undo_redo() {
        let mut s = Store::new();
        let a = s.add(m(RECT));
        let b = s.add(m(TEXT));
        let c = s.add(m(RECT));
        assert_eq!(s.get(&b).unwrap().seq, Some(2));
        s.update(&[a.clone(), c.clone()], |m| m.points[0][0] += 5.0);
        assert_eq!(s.get(&a).unwrap().points[0][0], 5.0);
        s.remove(&[a.clone(), c.clone()]);
        assert_eq!(s.all().len(), 1);
        assert!(s.undo());
        let order: Vec<_> = s.all().iter().map(|m| m.id.clone()).collect();
        assert_eq!(
            order,
            vec![a.clone(), b.clone(), c.clone()],
            "deleted markups go back where they were"
        );
        assert!(s.undo());
        assert_eq!(s.get(&c).unwrap().points[0][0], 0.0);
        assert!(s.redo());
        assert_eq!(s.get(&c).unwrap().points[0][0], 5.0);
        while s.undo() {}
        assert!(s.all().is_empty());
        while s.redo() {}
        assert_eq!(s.all().len(), 1);
    }

    #[test]
    fn coalesced_is_one_step() {
        let mut s = Store::new();
        let a = s.add(m(RECT));
        for w in 2..10 {
            s.update_coalesced(std::slice::from_ref(&a), "width", |m| m.style.width = w as f64);
        }
        assert_eq!(s.get(&a).unwrap().style.width, 9.0);
        s.undo();
        assert_eq!(s.get(&a).unwrap().style.width, 1.5);
        s.undo();
        assert!(s.all().is_empty());
    }

    #[test]
    fn locked_markups_stay() {
        let mut s = Store::new();
        let a = s.add(m(RECT));
        s.update_any(&a, |m| m.locked = Some(true));
        s.update(std::slice::from_ref(&a), |m| m.points[0][0] = 99.0);
        s.remove(std::slice::from_ref(&a));
        assert_eq!(s.get(&a).unwrap().points[0][0], 0.0);
        s.update_any(&a, |m| m.status = "Accepted".into());
        assert_eq!(s.get(&a).unwrap().status, "Accepted");
    }
}
