-- The task lists the pages poll while videos and images are made filter sys_task by drama:
-- GET /episodes/:id/generation-tasks (every 3–4 s on the episode page) and GET /tasks?drama_id= (project
-- page and board). Without this index each poll reads every task of every project.
CREATE INDEX IF NOT EXISTS idx_sys_task_drama ON sys_task (drama_id);
