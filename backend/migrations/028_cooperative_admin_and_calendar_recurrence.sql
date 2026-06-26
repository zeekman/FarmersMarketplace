-- Add is_admin flag to cooperative_members
ALTER TABLE cooperative_members ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Set first member (creator) as admin for existing cooperatives
UPDATE cooperative_members
SET is_admin = TRUE
WHERE (cooperative_id, user_id) IN (
  SELECT cooperative_id, MIN(user_id)
  FROM cooperative_members
  GROUP BY cooperative_id
);

-- Add recurrence support to availability_calendar
ALTER TABLE availability_calendar ADD COLUMN available_from DATE;
ALTER TABLE availability_calendar ADD COLUMN available_until DATE;
ALTER TABLE availability_calendar ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none' CHECK(recurrence IN ('none','weekly','biweekly','monthly'));
ALTER TABLE availability_calendar ADD COLUMN recurrence_end DATE;
ALTER TABLE availability_calendar ADD COLUMN delete_instance_date DATE;
