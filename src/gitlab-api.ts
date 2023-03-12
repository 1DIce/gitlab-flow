import { getConfig } from "../src/config.ts";
import {
  CreateMergeRequestRequest,
  GitlabUser,
  MergeRequestResponse,
  UpdateMrBody,
} from "./gitlab-api.types.ts";

export class GitlabApi {
  fetchOpenMergeRequestForBranch(
    SourceBranchName: string,
  ): Promise<MergeRequestResponse[]> {
    return this.projectApiRequest(
      "/merge_requests?state=opened&source_branch=" + SourceBranchName,
    );
  }

  async fetchProjectLabels(): Promise<string[]> {
    const labels = await this.projectApiRequest("/labels") ?? [];
    return labels.map((label: { name: string }) => label.name);
  }

  async fetchAllRemoteBranchNames(): Promise<string[]> {
    const branches = await this.projectApiRequest("/repository/branches") ?? [];
    return branches.map((branch: { name: string }) => branch.name.trim());
  }

  findUsersByName(username: string): Promise<GitlabUser[]> {
    return this.apiRequest(`users?username=${username}`);
  }

  getCurrentUser(): Promise<GitlabUser> {
    return this.apiRequest("user");
  }

  createMergeRequest(body: CreateMergeRequestRequest) {
    return this.projectApiRequest("/merge_requests", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async updateMergeRequest(mrIid: number, body: UpdateMrBody) {
    const response = await this.projectApiRequest("/merge_requests/" + mrIid, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return response;
  }

  private async projectApiRequest(url: string, config?: RequestInit) {
    const jsonResponse = await fetch(
      new Request(
        getConfig().remoteBaseUrl + "/api/v4/" + "projects/" +
          getConfig().projectId + url,
        {
          headers: {
            Authorization: "Bearer " + this.getAccessToken(),
            "Content-Type": "application/json",
          },
          method: "GET",
          ...config,
        },
      ),
    );
    const jsonData = await jsonResponse.json();
    return jsonData;
  }

  private async apiRequest(url: string, config?: RequestInit) {
    const jsonResponse = await fetch(
      new Request(getConfig().remoteBaseUrl + "/api/v4/" + url, {
        headers: { Authorization: "Bearer " + this.getAccessToken() },
        method: "GET",
        ...(config ?? {}),
      }),
    );
    const jsonData = await jsonResponse.json();
    return jsonData;
  }

  private getAccessToken(): string {
    return getConfig().gitlabApiToken ?? Deno.env.get("GITLAB_API_TOKEN") ?? "";
  }
}
