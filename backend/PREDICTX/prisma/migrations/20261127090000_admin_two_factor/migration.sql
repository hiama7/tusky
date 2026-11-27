-- Two-factor sign-in for administrators. Additive: existing rows are unchanged.
ALTER TABLE `users`
  ADD COLUMN `totpSecret` VARCHAR(255) NULL,
  ADD COLUMN `totpEnabledAt` DATETIME(3) NULL,
  ADD COLUMN `totpLastStep` INTEGER NULL,
  ADD COLUMN `totpRecovery` JSON NULL;
