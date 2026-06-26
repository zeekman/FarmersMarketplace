ALTER TABLE cooperative_members DROP COLUMN IF EXISTS is_admin;
ALTER TABLE availability_calendar DROP COLUMN IF EXISTS available_from;
ALTER TABLE availability_calendar DROP COLUMN IF EXISTS available_until;
ALTER TABLE availability_calendar DROP COLUMN IF EXISTS recurrence;
ALTER TABLE availability_calendar DROP COLUMN IF EXISTS recurrence_end;
ALTER TABLE availability_calendar DROP COLUMN IF EXISTS delete_instance_date;
