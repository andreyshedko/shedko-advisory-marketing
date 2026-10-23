CREATE TABLE research_remote_files (
 repository text NOT NULL, path text NOT NULL, sha text NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(repository,path)
);
