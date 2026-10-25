# Who Is the Imposter? — One Word, One Outsider

A phone-first social deduction game for 4–12 players. The crew gets one secret word; the imposter has to infer it from everyone's clues. After a wrong vote, the imposter gets one final guess.

## What is included

- `index.html`, `styles.css`, `app.js` — the responsive, login-free player experience.
- `supabase/migrations/202610250001_game_rooms.sql` — private room state and access rules.
- `supabase/functions/game-api/index.ts` — server-authoritative game actions, private role delivery, room-code validation, and safe room snapshots.
- `.github/workflows/deploy.yml` — deploys the static site to GitHub Pages when changes land on `main`.
- `cover.svg` — contest cover art.

## Live deployment

- **Play:** https://sjamjampr-cmd.github.io/who-is-the-imposter/
- **Public source:** https://github.com/sjamjampr-cmd/who-is-the-imposter
- **Realtime backend:** Supabase project `who-is-the-imposter` (`dxwlncuxyhvuqpphybzj`, US East)

GitHub Pages hosts the static game, and Supabase provides guest sessions, private room state, and realtime refresh signals. The database migration and `game-api` Edge Function are deployed. Anonymous sign-ins are enabled, so players do not need email, passwords, an account, or an install. No service-role key is included in the repository or client.

The GitHub Actions workflow deploys the site on each push to `main`. It publishes the page bundle only; server source and database schema are excluded from the deployed website. Future changes to room-state or Edge Function code should be deployed to Supabase as well as committed to GitHub.

## How a round works

1. The host creates a room and shares its six-character code/link. Players choose a nickname and join.
2. At 4–12 players, the host starts the round. Every player privately sees their role: one random imposter sees no word; everyone else sees the same secret word.
3. Players privately submit one short clue in turn. Clues appear to the room together after the last player submits.
4. Players discuss face to face, then vote privately. Individual ballots never appear in the shared snapshot.
5. If the imposter is found, the crew wins. If the vote misses, the imposter gets one guess. A correct guess wins for the imposter; a miss wins for the crew.
6. The host starts another round in the same room.

Rooms stop accepting actions after 12 hours and are deleted the next time their code is used. The host can start clues if a player is away, skip a stalled clue turn, or close a partially completed vote. Refreshing the page restores the guest identity and reconnects to its last room in that browser.

## Game behavior and privacy

The public frontend only receives the phase, player list, clues after the clue round, and safe result data. Room state containing roles, the current word, unsubmitted clues, and individual votes stays in the Supabase server-side table and is accessible only through the Edge Function. Private ballots are aggregated only after votes close. Realtime messages only tell clients to fetch an updated safe snapshot.

Nicknames are shown to other room players. The game does not ask for an email, full name, or location. A public room code is a temporary invitation; only share it with people you want in that room.

## Contest entry text

- **Title:** Who Is the Imposter? — One Word, One Outsider
- **Description:** A quick, phone-friendly social deduction game for 4–12 friends. Everyone except one player gets the same secret word. Take turns giving short clues, discuss face to face, then vote privately on your phone. If the group votes for the wrong person, the imposter gets one chance to guess the secret word and steal the win. Create a room, share its code, and play together—no account or install required for players.
- **Cover image:** `cover.svg`
- **Link:** https://sjamjampr-cmd.github.io/who-is-the-imposter/

The official contest rules require a title, cover image, description, and project URL submitted through the Handshake AI Skills Studio “Create a Multiplayer Game” mission by October 30, 2026 at 11:59 p.m. PT.
