-- A passed quiz may refer to an effect already recorded outside this attempt.
-- Preserve existing results and timestamps while allowing no duplicate award.
ALTER TABLE learning_attempts DROP CONSTRAINT learning_attempts_check;
ALTER TABLE learning_attempts ADD CONSTRAINT learning_attempts_passed_check
  CHECK ((status = 'passed') = (passed_at IS NOT NULL)
    AND (completion_result IS NULL OR status = 'passed'));
