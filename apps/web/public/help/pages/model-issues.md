# Issues in 3D models

Raise an issue at a place in the model, and it shows on your sheets as a cloud and callout too. Issues are saved in the BCF format, so you can pass them to and from other BIM tools.

![The Issues section with one issue](img/model-issues.png)

## Raise an issue

1. Select the element the issue is about, or turn the camera to look at the place.
2. In the **3D Model** panel, open **Issues**, type a title and click **New issue**.

The issue keeps the camera view and a picture of it. On every open sheet registered to the same map, a cloud and callout appear at the issue's place. The markup's subject is **BCF**.

> **Note:** Issues need the model's place on the map (see [3D models and sheets on the map](#model-sheets)).

## Work on an issue

Click an issue to open it. The camera goes back to the issue's view, and you can:

- Change its **Title**, **Status**, **Priority**, **Assigned to**, **Due** date, **Labels** (separated by commas) and **Description**.
- Add comments.

Changes go both ways: a status set on the sheet's markup changes the issue, and the other way round. The issues also appear in the comment register when you export it to Excel.

Filter the list by status or assignee, or type in **Search**.

## Share issues

- **Export BCF…** saves every issue in a `.bcfzip` file.
- **Import BCF…** reads one in. An issue you already have is replaced by the imported one, not added twice.
