-- Indexes for the columns the hot paths filter on (counted from the code: storyboards.episode_id is the most
-- used filter in the backend). On SQLite these lookups scanned in-process; on PostgreSQL an unindexed filter
-- reads the whole table on every poll of the episode workbench.
-- Join tables (storyboard_characters / _props / _character_looks / media selections) are already covered by
-- their primary keys, which lead with storyboard_id.

CREATE INDEX IF NOT EXISTS idx_storyboards_episode ON storyboards (episode_id, storyboard_number);
CREATE INDEX IF NOT EXISTS idx_episodes_drama ON episodes (drama_id);
CREATE INDEX IF NOT EXISTS idx_characters_drama ON characters (drama_id);
CREATE INDEX IF NOT EXISTS idx_scenes_drama ON scenes (drama_id);
CREATE INDEX IF NOT EXISTS idx_props_drama ON props (drama_id);
CREATE INDEX IF NOT EXISTS idx_video_merges_episode ON video_merges (episode_id);
-- the per-config GPU queue: type = 'video' AND config_id = ? AND status = ?
CREATE INDEX IF NOT EXISTS idx_sys_task_config_status ON sys_task (config_id, status);
-- startup recovery and the queue pump look only at live tasks
CREATE INDEX IF NOT EXISTS idx_sys_task_live ON sys_task (status) WHERE status IN ('queued', 'submitting', 'processing', 'unknown');
CREATE INDEX IF NOT EXISTS idx_pipeline_tasks_status ON pipeline_tasks (status);
CREATE INDEX IF NOT EXISTS idx_clone_variants_status ON clone_variants (status);
