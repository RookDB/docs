import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    "index",

    // User Guide
    "CLI",

    // Storage Engine Section
    {
      type: "category",
      label: "Storage Engine",
      collapsed: false,
      items: [
        "storage-engine/Introduction",
        "storage-engine/API-Doc",
        "storage-engine/database-doc",
        "storage-engine/design-doc",
        "storage-engine/Developer-Guide",

        // Projects subsection
        {
          type: "category",
          label: "Projects",
          collapsed: false,
          items: [
            // Indexing
            {
              type: "category",
              label: "Indexing",
              collapsed: true,
              items: [
                "storage-engine/projects/indexing/indexing",
              ],
            },
            // JOIN Algorithms
            {
              type: "category",
              label: "JOIN Algorithms",
              collapsed: true,
              items: [
                "storage-engine/projects/join-algorithms/join-algorithms",
              ],
            },
            // Buffer Manager
            {
              type: "category",
              label: "Buffer Manager",
              collapsed: true,
              items: [
                "storage-engine/projects/buffer-manager/buffer-manager",
              ],
            },

            // Catalog Manager
            {
              type: "category",
              label: "Catalog Manager",
              collapsed: true,
              items: [
                "storage-engine/projects/catalog-manager/catalog-manager",
                "storage-engine/projects/catalog-manager/overview",
                "storage-engine/projects/catalog-manager/architecture",
                "storage-engine/projects/catalog-manager/system-catalogs",
                "storage-engine/projects/catalog-manager/data-structures",
                "storage-engine/projects/catalog-manager/api-reference",
                "storage-engine/projects/catalog-manager/implementation-notes",
                "storage-engine/projects/catalog-manager/physical-storage",
              ],
            },

            // Sorting and Ordering
            {
              type: "category",
              label: "Sorting and Ordering",
              collapsed: true,
              items: [
                "storage-engine/projects/sorting-and-ordering/sorting-and-ordering",
              ],
            },
            
            // FSM and Heap Manager
            {
              type: "category",
              label: "FSM and Heap Manager",
              collapsed: true,
              items: [
                "storage-engine/projects/fsm-heap-manager/fsm-heap-manager",
              ],
            },

            // Fixed Length Data Types
            {
              type: "category",
              label: "Fixed Length Data Types",
              collapsed: true,
              items: [
                "storage-engine/projects/fixed-length-data-types/fixed-length-data-types",
              ],
            },

            // Variable Length Data Types
            {
              type: "category",
              label: "Variable Length Data Types",
              collapsed: true,
              items: [
                "storage-engine/projects/variable-length/varchar-text",
                "storage-engine/projects/variable-length/blob-array",
                "storage-engine/projects/variable-length/semi-structured",
              ],
            },

            // Select Project Aggregate
            {
              type: "category",
              label: "Select Project Aggregate",
              collapsed: true,
              items: [
                "storage-engine/projects/select-project-aggregate/selection",
                "storage-engine/projects/select-project-aggregate/projection",
                "storage-engine/projects/select-project-aggregate/aggregatation",
              ],
            },

            // Update and Delte
            {
              type: "category",
              label: "Update and Delete",
              collapsed: true,
              items: [
                "storage-engine/projects/update-delete/update-delete",
              ],
            },
          ],
        },
      ],
    },

    
    
    // CLI Sidebar
    {
  type: "category",
  label: "CLI",
  collapsed: false,
  items: [
    "CLI-Dev-Docs",
  ],
},
    "Rook-Parser",
  ],
};

export default sidebars;