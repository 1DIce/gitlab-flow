export interface GitlabUser {
  id: string;
}

export interface UpdateMrBody {
  title?: string;
}

export interface CreateMergeRequestRequest {
  source_branch: string;
  target_branch: string;
  title: string;
  description?: string;
  reviewer_ids: string[];
  assignee_id: string;
  labels: string[];
  remove_source_branch: boolean;
  squash: boolean;
}
