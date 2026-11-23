CREATE TABLE IF NOT EXISTS red_souls (
  id CHAR(36) PRIMARY KEY,
  winner_id CHAR(36) NOT NULL,
  team_id CHAR(36) NOT NULL,
  full_name VARCHAR(240) NOT NULL,
  address VARCHAR(500) NOT NULL,
  phone VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL UNIQUE,
  email VARCHAR(254) COLLATE utf8mb4_bin NULL UNIQUE,
  consent_recorded_at DATETIME NOT NULL,
  stage ENUM('recorded','under_training','completed_training','equipped','deployed') NOT NULL DEFAULT 'recorded',
  recorded_at DATETIME NOT NULL,
  recorded_on DATE NOT NULL,
  report_month DATE NOT NULL,
  invalidated_at DATETIME NULL,
  invalidated_by CHAR(36) NULL,
  invalidation_reason VARCHAR(500) NULL,
  INDEX red_souls_winner_idx (winner_id, recorded_on, report_month),
  INDEX red_souls_team_idx (team_id, report_month, invalidated_at),
  INDEX red_souls_report_idx (report_month, invalidated_at),
  CONSTRAINT red_souls_winner_fk FOREIGN KEY (winner_id) REFERENCES profiles(id),
  CONSTRAINT red_souls_team_fk FOREIGN KEY (team_id) REFERENCES red_teams(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS red_soul_stages (
  id CHAR(36) PRIMARY KEY,
  soul_id CHAR(36) NOT NULL,
  actor_id CHAR(36) NOT NULL,
  prior_stage ENUM('recorded','under_training','completed_training','equipped','deployed') NULL,
  stage ENUM('recorded','under_training','completed_training','equipped','deployed') NOT NULL,
  reason VARCHAR(500) NULL,
  changed_at DATETIME(6) NOT NULL,
  INDEX red_stage_soul_idx (soul_id, changed_at),
  CONSTRAINT red_stage_soul_fk FOREIGN KEY (soul_id) REFERENCES red_souls(id),
  CONSTRAINT red_stage_actor_fk FOREIGN KEY (actor_id) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
