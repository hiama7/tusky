-- Links a match imported from the ML service ("ml:<id>") so a re-sync updates it instead of duplicating it.
ALTER TABLE `matches` ADD COLUMN `externalId` VARCHAR(60) NULL;
CREATE UNIQUE INDEX `matches_externalId_key` ON `matches`(`externalId`);
