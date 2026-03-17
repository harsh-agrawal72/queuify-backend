-- Fix NULL notification toggles
UPDATE organizations SET email_notification = TRUE WHERE email_notification IS NULL;
UPDATE organizations SET new_booking_notification = TRUE WHERE new_booking_notification IS NULL;
UPDATE users SET notification_enabled = TRUE WHERE notification_enabled IS NULL;
UPDATE users SET email_notification_enabled = TRUE WHERE email_notification_enabled IS NULL;

-- Ensure contact_email is not empty where possible (using admin email if available)
UPDATE organizations o
SET contact_email = u.email
FROM users u
WHERE o.contact_email IS NULL 
AND u.org_id = o.id 
AND u.role = 'admin';
