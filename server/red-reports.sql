CREATE TABLE IF NOT EXISTS red_reports (
  id CHAR(36) PRIMARY KEY,
  team_id CHAR(36) NOT NULL,
  leader_id CHAR(36) NOT NULL,
  report_month DATE NOT NULL,
  submitted_at DATETIME NOT NULL,
  submitted_on DATE NOT NULL,
  summary_json JSON NOT NULL,
  created_members INT UNSIGNED NOT NULL,
  linked_members INT UNSIGNED NOT NULL,
  UNIQUE KEY red_team_report_month (team_id, report_month),
  INDEX red_reports_month_idx (report_month, submitted_on),
  CONSTRAINT red_reports_team_fk FOREIGN KEY (team_id) REFERENCES red_teams(id),
  CONSTRAINT red_reports_leader_fk FOREIGN KEY (leader_id) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
