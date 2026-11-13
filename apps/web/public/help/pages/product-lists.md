# Product Lists

A product list is a table of products, such as a supplier's price list or a labour rate sheet. [Items](#estimating-items) link to one of its records and take their cost and price from it, so updating the list updates every item, assembly and total that uses it.

## Make a list

1. Choose {{Tools > Takeoff > Product Lists…}}, or click **Product Lists** on the **Takeoff** tab.
2. Either:
   - click **Import CSV…** and pick a CSV file. Its header row becomes the list's columns and every other row a record. A column whose values are all numbers (`$12.50` and `1,200` count) is a number column; or
   - click **+ New** for a list with Name, Cost and Price columns, and type the records in with **+ Record**.
3. Rename columns, change their type (**Text** or **Number**), or add and remove them in the grid's header.
4. Click **Save**. Lists are saved in the PDF with the document.

## Which columns are the cost and the price

An item linked to a record takes:

- its **unit cost** from the column chosen under **Cost column**, or, when that says *Named Cost / Unit Cost*, the column named **Cost** or **Unit Cost**;
- its **unit price** from the column chosen under **Price column**, or the column named **Price** or **Unit Price**.

A blank or non-number value falls back to the item's own cost or price.

## Use lists in other documents

**Save to Library** keeps a copy of the selected list in this browser; **From library…** brings one into this document. Lists also travel in estimating files with the items that use them.
