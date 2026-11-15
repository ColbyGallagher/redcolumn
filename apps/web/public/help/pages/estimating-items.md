# Items (the estimating catalog)

Items are the cost lines your assemblies price from: the materials, labour, equipment, subcontracts and other costs you buy or pay for. Set an item up once, with its unit, cost, waste and rounding, and every assembly that links to it uses those values. Change the item's cost and every assembly that uses it follows.

## Set up items

1. Choose {{Tools > Takeoff > Items…}}, or click **Items** in the **Estimating** group on the **Takeoff** tab.
2. Click **+ Item** and fill in the row:

   | Box | Means |
   |---|---|
   | **Item no.** | Your own item or cost code. |
   | **Name** | What the totals call it. Two items cannot share a name. |
   | **Category** | Material, Labour, Equipment, Subcontract or Other. |
   | **Unit** | What it is counted in: `ea`, `sheets`, `lf`, `m²`, `hr`. |
   | **Unit cost** | What one unit costs you. |
   | **Unit price** | What you sell one unit for. |
   | **Waste %** | An allowance added before rounding. |
   | **Round up** | Tick for things bought whole. Type a number beside it to round up to the nearest multiple of it instead: `10` for pipe sold in 10 ft lengths. |
   | **SKU**, **Description** | Your supplier's code, and a note. |
   | **Product list** | A price list record the cost and price come from (see below). |

3. Click **Save**. Items are saved in the PDF with the document.

Use **Category** at the top to show one kind of item at a time.

## Use an item in an assembly

In {{Tools > Takeoff > Assemblies…}}, pick the item under **Catalog** on an assembly's item row. The row then takes the item's name, unit, unit cost, waste and rounding: they show greyed in the row's boxes. Type into a box to set that value for this assembly only; clear it to go back to the item's.

See [Assemblies](#assemblies) for the rest of the assembly.

## Price an item from a product list

Pick a list under **Product list**, then the record. The item's **Unit cost** and **Unit price** then come from that record, marked *(list)*. Which of the list's columns they come from is set in [Product Lists](#product-lists). If the record is deleted, or its cost is blank, the item's own cost is used.

## Use items in other documents

- **Save to Library** keeps a copy of the items (and the product lists they price from) in this browser.
- **Add from library…** brings a library item into this document, with its product list.
- Items travel with assemblies and templates in an estimating file: see [Share assemblies](#assemblies).
