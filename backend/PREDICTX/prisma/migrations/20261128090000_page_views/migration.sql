-- Anonymous page-view counts. Additive: no existing table changes.
CREATE TABLE `page_views` (
  `day` DATE NOT NULL,
  `path` VARCHAR(60) NOT NULL,
  `views` INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (`day`, `path`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
