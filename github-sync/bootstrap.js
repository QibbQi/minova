import { createGitHubSync } from './sync.js'
import { mountGitHubSyncUi } from './ui.js'

export function initGitHubSync({ getLocalState, applyRemoteState }) {
  const sync = createGitHubSync({ getLocalState, applyRemoteState })
  mountGitHubSyncUi({ sync })
  return sync
}

