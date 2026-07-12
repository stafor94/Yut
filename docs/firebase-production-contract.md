# Firebase production contract

## Production project

- Firebase project: `yut-online`
- Firestore database: `(default)`
- Client authentication: Anonymous Authentication
- Source-controlled project alias: `.firebaserc`
- Source-controlled Rules and index config: `firebase.json`

## Required Firebase Console settings

The following setting cannot be enabled from this repository and must be confirmed in Firebase Console before deployment.

1. Open `yut-online`.
2. Go to **Authentication > Sign-in method**.
3. Enable **Anonymous**.
4. Confirm the `(default)` Firestore database exists.
5. Do not deploy `firestore.qa.rules` to production. It intentionally allows all Emulator reads and writes.

When Anonymous Authentication is disabled, the app now reports a specific configuration error instead of a generic room creation failure.

## Production deployment

```bash
firebase use yut-online
firebase deploy --only firestore:rules,firestore:indexes
```

Review the deployed Rules timestamp and active project before running the second command in a new environment.

## Access contract

### Room documents

- Any authenticated user may read room summaries for the lobby.
- A user may create a room only when `hostId` is their own Firebase UID.
- A non-spectator room member may update room lifecycle and Presence lease fields.
- A room may be deleted by a room participant or when it is finished, empty, or older than two hours.

### Players and seats

- Authenticated users may read player and seat summaries required by the lobby and join transaction.
- A user may create or update their own player document.
- Room participants may maintain AI substitute, stale Presence, and seat state required by the client-authoritative coordinator flow.
- Spectators do not receive game-state write access.

### Game state and event collections

The following paths are readable only by room members and writable only by non-spectator room members or the current room host:

- `rooms/{roomId}/state/*`
- `rooms/{roomId}/actions/*`
- `rooms/{roomId}/processedActions/*`
- `rooms/{roomId}/sequences/*`
- `rooms/{roomId}/boardItems/*`

This matches the current architecture where a room participant executes the authoritative Firestore transaction and another human participant can take over coordinator work for AI or disconnected players.

## Index contract

Current queries use single-field indexes:

- room `status`
- room `hostId`
- room `qaRunId`
- sequence `sequence`

No composite index is currently required. `firestore.indexes.json` intentionally keeps the composite list empty.

Automatic indexing is disabled for large payload fields that are never queried, including state arrays/maps and sequence snapshots. This reduces write amplification and index storage without affecting recovery queries by `sequence`.

## Final validation matrix

Rules Emulator tests are deferred to the final validation phase and must cover:

- unauthenticated lobby read denied
- authenticated room list read allowed
- room creation denied when `hostId` differs from the authenticated UID
- self player create/update allowed
- outsider game-state read/write denied
- spectator game-state read allowed and write denied
- active member state/action/sequence transaction allowed
- Presence lease owner player/seat cleanup allowed
- AI substitute coordinator action allowed
- finished, empty, and expired room cleanup allowed
- arbitrary active-room deletion by an outsider denied
- QA rules remain isolated to `firebase.qa.json`
