import git
import os
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

class GitService:
    def __init__(self):
        pass

    def clone_repository(self, repo_url, target_path, auth_token=None):
        """
        Clones a repository from the given URL to the target path.
        If auth_token is provided, it's injected into the repo_url for authentication.
        """
        try:
            if auth_token:
                # Inject token into URL: https://<token>@github.com/user/repo.git
                if repo_url.startswith("https://"):
                    auth_url = repo_url.replace("https://", f"https://{auth_token}@")
                else:
                    auth_url = repo_url  # SSH or other protocols might not work simply with this method
            else:
                auth_url = repo_url

            logger.info(f"Cloning repository from {repo_url} to {target_path}")
            
            # Ensure target directory exists or parent exists
            if not os.path.exists(target_path):
                os.makedirs(target_path)
                
            repo = git.Repo.clone_from(auth_url, target_path)
            return {"success": True, "message": "Repository cloned successfully", "path": target_path}
        except Exception as e:
            logger.error(f"Error cloning repository: {str(e)}")
            return {"success": False, "error": str(e)}

    def get_status(self, repo_path):
        """
        Gets the git status of the repository at the given path.
        """
        try:
            repo = git.Repo(repo_path)
            if repo.bare:
                return {"success": False, "error": "Repository is bare"}

            changed_files = [item.a_path for item in repo.index.diff(None)]
            untracked_files = repo.untracked_files
            staged_files = [item.a_path for item in repo.index.diff("HEAD")]
            
            # Get current branch
            try:
                current_branch = repo.active_branch.name
            except TypeError:
                current_branch = "DETACHED_HEAD" # or similar handling

            return {
                "success": True, 
                "branch": current_branch,
                "changed": changed_files,
                "untracked": untracked_files,
                "staged": staged_files
            }
        except git.exc.InvalidGitRepositoryError:
            return {"success": False, "error": "Not a git repository"}
        except Exception as e:
            logger.error(f"Error getting git status: {str(e)}")
            return {"success": False, "error": str(e)}

    def commit_changes(self, repo_path, message):
        """
        Stages all changes and commits them with the given message.
        """
        try:
            repo = git.Repo(repo_path)
            # Stage all changes (including untracked)
            repo.git.add(A=True) 
            
            if not repo.index.diff("HEAD"):
                 return {"success": False, "error": "Nothing to commit"}

            commit = repo.index.commit(message)
            return {"success": True, "message": "Changes committed successfully", "commit_hash": commit.hexsha}
        except Exception as e:
            logger.error(f"Error committing changes: {str(e)}")
            return {"success": False, "error": str(e)}

    def push_changes(self, repo_path, branch=None, auth_token=None):
        """
        Pushes committed changes to the remote repository.
        """
        try:
            repo = git.Repo(repo_path)
            if not branch:
                try:
                    branch = repo.active_branch.name
                except TypeError:
                    return {"success": False, "error": "Head is detached"}
            
            origin = repo.remote(name='origin')
            
            # If auth token is provided, update the remote URL temporarily or use it in the push command
            # Updating remote URL is safer for consistent future operations if desired, 
            # but usually we might just want to use it for this session. 
            # For simplicity, we assume the remote URL was set up correctly during clone if token was used.
            # However, if the user authenticates later, we might need to update the remote.
            
            if auth_token:
                current_url = origin.url
                if "github.com" in current_url and "https://" in current_url and "@" not in current_url:
                     new_url = current_url.replace("https://", f"https://{auth_token}@")
                     origin.set_url(new_url)
            
            push_info = origin.push(branch)[0]
            
            if push_info.flags & git.PushInfo.ERROR:
                return {"success": False, "error": f"Push failed: {push_info.summary}"}
                
            return {"success": True, "message": "Changes pushed successfully"}
        except Exception as e:
            logger.error(f"Error pushing changes: {str(e)}")
            return {"success": False, "error": str(e)}

    def pull_changes(self, repo_path, branch=None):
        """
        Pulls changes from the remote repository.
        """
        try:
            repo = git.Repo(repo_path)
            if not branch:
                try:
                    branch = repo.active_branch.name
                except TypeError:
                     return {"success": False, "error": "Head is detached"}
            
            origin = repo.remote(name='origin')
            try:
                origin.pull(branch)
                return {"success": True, "message": "Changes pulled successfully"}
            except git.exc.GitCommandError as e:
                # Check for merge conflicts
                if "Merge conflict" in str(e) or "CONFLICT" in str(e):
                    # Get conflicted files
                    unmerged_blobs = repo.index.unmerged_blobs()
                    conflicted_files = list(unmerged_blobs.keys())
                    return {
                        "success": False, 
                        "error": "Merge conflict detected", 
                        "conflicts": conflicted_files,
                        "is_conflict": True
                    }
                raise e

        except Exception as e:
            logger.error(f"Error pulling changes: {str(e)}")
            return {"success": False, "error": str(e)}

    def get_history(self, repo_path, limit=50):
        """
        Gets the commit history of the repository.
        """
        try:
            repo = git.Repo(repo_path)
            commits = list(repo.iter_commits(max_count=limit))
            history = []
            for commit in commits:
                history.append({
                    "hash": commit.hexsha,
                    "short_hash": commit.hexsha[:7],
                    "message": commit.message.strip(),
                    "author": commit.author.name,
                    "date": datetime.fromtimestamp(commit.committed_date).isoformat(),
                    "files": list(commit.stats.files.keys())
                })
            return {"success": True, "history": history}
        except Exception as e:
            logger.error(f"Error getting history: {str(e)}")
            return {"success": False, "error": str(e)}

    def resolve_conflicts(self, repo_path, files):
        """
        Stages the given files, marking them as resolved.
        files: list of file paths that have been manually resolved by the user/agent.
        """
        try:
            repo = git.Repo(repo_path)
            repo.index.add(files)
            return {"success": True, "message": "Conflicts resolved for specified files"}
        except Exception as e:
             logger.error(f"Error resolving conflicts: {str(e)}")
             return {"success": False, "error": str(e)}
