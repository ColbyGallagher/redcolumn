import { useJobs } from '../jobs/jobs';

/** Long-running jobs (OCR, …) with their progress and a Cancel button. */
export function JobsBar() {
  const jobs = useJobs();
  if (!jobs.length) return null;
  return (
    <div className="jobs-bar" role="status">
      {jobs.map((j) => (
        <div key={j.id} className="job">
          <div className="job-head">
            <b>{j.label}</b>
            <button className="btn small flat" onClick={j.cancel}>
              Cancel
            </button>
          </div>
          <progress max={j.total || 1} value={j.total ? j.done : undefined} />
          <span className="job-status">{j.status}</span>
        </div>
      ))}
    </div>
  );
}
