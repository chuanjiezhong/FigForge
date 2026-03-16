import { spawn } from 'child_process'
import { join } from 'path'
import { mkdir, access } from 'fs/promises'
import { constants } from 'fs'
import { homedir } from 'os'

/**
 * Git 仓库管理器
 * 用于在运行时克隆和管理外部 GitHub 仓库
 */
export class GitManager {
  /**
   * 检查 Git 是否可用
   */
  async checkGitAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const gitProcess = spawn('git', ['--version'])
      gitProcess.on('close', (code) => {
        resolve(code === 0)
      })
      gitProcess.on('error', () => {
        resolve(false)
      })
    })
  }

  /**
   * 克隆 GitHub 仓库
   */
  async cloneRepository(
    repoUrl: string,
    targetPath: string,
    branch?: string,
    options?: {
      sshKeyPath?: string
      token?: string
    }
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      // 确保目标目录的父目录存在
      const parentDir = join(targetPath, '..')
      mkdir(parentDir, { recursive: true })
        .then(() => {
          // 处理认证：如果是 HTTPS URL 且有 token，嵌入到 URL 中
          let finalRepoUrl = repoUrl
          if (options?.token && repoUrl.startsWith('https://')) {
            // 将 token 嵌入到 URL 中
            finalRepoUrl = repoUrl.replace('https://', `https://${options.token}@`)
          }

          const args = ['clone', finalRepoUrl, targetPath]
          if (branch) {
            args.push('--branch', branch, '--single-branch')
          }

          // 配置环境变量
          const env = { ...process.env }
          
          // 如果使用 SSH 密钥，配置 GIT_SSH_COMMAND
          if (options?.sshKeyPath) {
            env.GIT_SSH_COMMAND = `ssh -i ${options.sshKeyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no`
          }

          const gitProcess = spawn('git', args, {
            stdio: 'pipe',
            env,
          })

          let errorOutput = ''

          gitProcess.stderr?.on('data', (data) => {
            errorOutput += data.toString()
          })

          gitProcess.on('close', (code) => {
            if (code === 0) {
              resolve({ success: true })
            } else {
              resolve({
                success: false,
                error: `Git clone failed: ${errorOutput || `exit code ${code}`}`,
              })
            }
          })

          gitProcess.on('error', (error) => {
            resolve({
              success: false,
              error: `Failed to spawn git process: ${error.message}`,
            })
          })
        })
        .catch((error) => {
          resolve({
            success: false,
            error: `Failed to create directory: ${error.message}`,
          })
        })
    })
  }

  /**
   * 更新仓库（pull）
   */
  async updateRepository(
    repoPath: string,
    branch?: string,
    options?: {
      sshKeyPath?: string
      token?: string
    }
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      // 检查目录是否存在
      access(repoPath, constants.F_OK)
        .then(() => {
          const args = ['pull']
          if (branch) {
            args.push('origin', branch)
          }

          // 配置环境变量
          const env = { ...process.env }
          
          // 如果指定了 SSH 密钥路径，使用指定的密钥
          if (options?.sshKeyPath) {
            env.GIT_SSH_COMMAND = `ssh -i ${options.sshKeyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no`
          }
          // 如果没有指定，Git 会自动使用默认的 SSH 密钥（~/.ssh/id_rsa, ~/.ssh/id_ed25519 等）

          const gitProcess = spawn('git', args, {
            cwd: repoPath,
            stdio: 'pipe',
            env,
          })

          let errorOutput = ''

          gitProcess.stderr?.on('data', (data) => {
            errorOutput += data.toString()
          })

          gitProcess.on('close', (code) => {
            if (code === 0) {
              resolve({ success: true })
            } else {
              resolve({
                success: false,
                error: `Git pull failed: ${errorOutput || `exit code ${code}`}`,
              })
            }
          })

          gitProcess.on('error', (error) => {
            resolve({
              success: false,
              error: `Failed to spawn git process: ${error.message}`,
            })
          })
        })
        .catch(() => {
          resolve({
            success: false,
            error: 'Repository directory does not exist',
          })
        })
    })
  }

  /**
   * 检查仓库是否存在
   */
  async repositoryExists(repoPath: string): Promise<boolean> {
    try {
      await access(join(repoPath, '.git'), constants.F_OK)
      return true
    } catch {
      return false
    }
  }

  /**
   * 从 GitHub URL 提取仓库信息
   */
  parseGitHubUrl(url: string): { owner: string; repo: string; branch?: string } | null {
    // 支持多种 GitHub URL 格式
    // https://github.com/owner/repo.git
    // https://github.com/owner/repo
    // git@github.com:owner/repo.git
    const patterns = [
      /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+))?$/,
      /github\.com\/([^/]+)\/([^/]+?)(?:\/tree\/([^/]+))?$/,
    ]

    for (const pattern of patterns) {
      const match = url.match(pattern)
      if (match) {
        return {
          owner: match[1],
          repo: match[2].replace(/\.git$/, ''),
          branch: match[3],
        }
      }
    }

    return null
  }
}

