CREATE TABLE IF NOT EXISTS red_settings (
  id TINYINT UNSIGNED PRIMARY KEY,
  goal INT UNSIGNED NOT NULL DEFAULT 3000,
  monthly_target SMALLINT UNSIGNED NOT NULL DEFAULT 3,
  team_size TINYINT UNSIGNED NOT NULL DEFAULT 5,
  campaign_start DATE NOT NULL,
  campaign_end DATE NOT NULL,
  final_report_opens DATE NOT NULL,
  report_open_day TINYINT UNSIGNED NOT NULL DEFAULT 25,
  report_close_day TINYINT UNSIGNED NOT NULL DEFAULT 5,
  leader_expiry_hours SMALLINT UNSIGNED NOT NULL DEFAULT 48,
  leader_link_capacity TINYINT UNSIGNED NOT NULL DEFAULT 10,
  member_expiry_days SMALLINT UNSIGNED NOT NULL DEFAULT 7,
  CONSTRAINT red_single_settings CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO red_settings (id, campaign_start, campaign_end, final_report_opens)
VALUES (1, '2026-11-20', '2027-04-22', '2027-04-22');

CREATE TABLE IF NOT EXISTS red_teams (
  id CHAR(36) PRIMARY KEY,
  leader_id CHAR(36) NOT NULL UNIQUE,
  seat_limit TINYINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL,
  deactivated_at DATETIME NULL,
  CONSTRAINT red_teams_leader_fk FOREIGN KEY (leader_id) REFERENCES profiles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS red_team_members (
  profile_id CHAR(36) PRIMARY KEY,
  team_id CHAR(36) NOT NULL,
  joined_at DATETIME NOT NULL,
  INDEX red_team_members_team_idx (team_id, joined_at),
  CONSTRAINT red_team_members_profile_fk FOREIGN KEY (profile_id) REFERENCES profiles(id),
  CONSTRAINT red_team_members_team_fk FOREIGN KEY (team_id) REFERENCES red_teams(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS red_invites (
  id CHAR(36) PRIMARY KEY,
  kind ENUM('leader', 'member') NOT NULL,
  team_id CHAR(36) NULL,
  token_hash BINARY(32) NOT NULL UNIQUE,
  capacity TINYINT UNSIGNED NOT NULL,
  used_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_by CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  INDEX red_invites_team_idx (team_id, revoked_at, created_at),
  INDEX red_invites_kind_idx (kind, created_at),
  CONSTRAINT red_invites_team_fk FOREIGN KEY (team_id) REFERENCES red_teams(id),
  CONSTRAINT red_invites_creator_fk FOREIGN KEY (created_by) REFERENCES profiles(id),
  CONSTRAINT red_invites_kind_team CHECK ((kind = 'leader' AND team_id IS NULL) OR (kind = 'member' AND team_id IS NOT NULL)),
  CONSTRAINT red_invites_uses CHECK (used_count <= capacity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS red_invite_responses (
  id CHAR(36) PRIMARY KEY,
  invite_id CHAR(36) NOT NULL,
  kind ENUM('accepted', 'declined') NOT NULL,
  profile_id CHAR(36) NULL UNIQUE,
  responded_at DATETIME NOT NULL,
  INDEX red_invite_responses_invite_idx (invite_id, kind, responded_at),
  CONSTRAINT red_invite_responses_invite_fk FOREIGN KEY (invite_id) REFERENCES red_invites(id),
  CONSTRAINT red_invite_responses_profile_fk FOREIGN KEY (profile_id) REFERENCES profiles(id),
  CONSTRAINT red_invite_responses_actor CHECK ((kind = 'accepted' AND profile_id IS NOT NULL) OR (kind = 'declined' AND profile_id IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
