# Page Layout

For reference, the PostgreSQL page layout is described at:  
https://www.postgresql.org/docs/current/storage-page-layout.html#STORAGE-PAGE-LAYOUT-FIGURE

Each data page is divided into:
- A **page header**, which stores the `lower` and `upper` offsets
- An **Item ID array**, growing forward from the page header
- **Tuple data**, appended from the end of the page backward

The page-related implementation is located in `src/backend/page/mod.rs`.


![Logical Layout of a Page](/assets/Page-Architecture.png)