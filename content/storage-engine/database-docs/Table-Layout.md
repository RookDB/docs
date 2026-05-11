# Table Layout

The first page of the file is reserved as the **Table Header**. Within this page, only the first 4 bytes are used to store the total number of pages that contain tuple data. The remaining bytes in the header page are currently unused.

All subsequent pages are data pages used to store tuples.

Each table file is logically divided into two distinct regions. The first region is a fixed-size table header occupying the initial 8 KB of the file. This header stores metadata required for table management, currently stores only the total number of allocated pages. The second region consists of a sequence of fixed-size data pages, each 8 KB in size, which store tuple data along with associated slot metadata.

![Logical Layout of a Table File](/assets/Table-Architecture.png)