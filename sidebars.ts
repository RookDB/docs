import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    "index",
    "CLI",
    "Rook-Parser",

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
          collapsed: true,
          items: [
            "storage-engine/projects/indexing",
            "storage-engine/projects/join-algorithms",
            "storage-engine/projects/buffer-manager",
            "storage-engine/projects/catalog-manager",
            "storage-engine/projects/sorted-ordered-file-manager",
            "storage-engine/projects/fsm-heap-manager",

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

            "storage-engine/projects/update-delete",
          ],
        },
      ],
    },
  ],
};

export default sidebars;