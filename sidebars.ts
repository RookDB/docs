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
        {
          type: "category",
          label: "Database Docs",
          collapsed: false,
          items: [
            "storage-engine/database-docs/database-doc",
            "storage-engine/database-docs/Table-Layout",
            "storage-engine/database-docs/Page-Layout",
            "storage-engine/database-docs/Tuple-Layout",
          ],
        },
        "storage-engine/design-doc",
        "storage-engine/selection",
        "storage-engine/Developer-Guide",
        // FSM and Heap Manager
        {
          type: "category",
          label: "FSM and Heap Manager",
          collapsed: true,
          items: [
            "storage-engine/fsm-heap-manager/fsm-heap-manager",
            "storage-engine/fsm-heap-manager/benchmark-report",
            "storage-engine/fsm-heap-manager/design-doc",
            "storage-engine/fsm-heap-manager/features-implemented",
            "storage-engine/fsm-heap-manager/free-space-manager",
            "storage-engine/fsm-heap-manager/heap-manager",
            "storage-engine/fsm-heap-manager/submission-requirements",
            "storage-engine/fsm-heap-manager/tests",
          ],
        },
        // Update and Delete
        {
          type: "category",
          label: "Update and Delete",
          collapsed: true,
          items: [
            "storage-engine/update-delete/index",
            "storage-engine/update-delete/algorithms",
            "storage-engine/update-delete/backend-functions",
            "storage-engine/update-delete/benchmark",
            "storage-engine/update-delete/data-structures",
            "storage-engine/update-delete/file-changes",
            "storage-engine/update-delete/frontend-steps",
          ],
        },
        // Statements Flow
        {
          type: "category",
          label: "Statements Flow/API Docs",
          collapsed: true,
          items: [
            "storage-engine/statements-flow/create_database",
            "storage-engine/statements-flow/create_table",
            "storage-engine/statements-flow/show_databases",
            "storage-engine/statements-flow/delete_tuple",
            "storage-engine/statements-flow/insert_tuple",
            "storage-engine/statements-flow/select_database",
            "storage-engine/statements-flow/select_tuples",
            "storage-engine/statements-flow/show_tables",
            "storage-engine/statements-flow/update_tuple",
          ],
        },

        "storage-engine/Code-Docs",

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
              items: ["storage-engine/projects/indexing/indexing"],
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
              items: ["storage-engine/projects/buffer-manager/buffer-manager"],
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
                "storage-engine/projects/select-project-aggregate/projection",
                "storage-engine/projects/select-project-aggregate/aggregatation",
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
      items: ["CLI-Dev-Docs"],
    },
    "Rook-Parser",
  ],
};

export default sidebars;
