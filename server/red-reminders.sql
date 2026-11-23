CREATE TABLE IF NOT EXISTS red_reminders (
  user_id CHAR(36) NOT NULL,
  week_start DATE NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (user_id, week_start),
  CONSTRAINT red_reminders_user_fk FOREIGN KEY (user_id) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
