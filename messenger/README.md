# otto on Photon

Text otto a photo of a piece of furniture. It replies with the closest pieces from the shop, each with a
picture, price, size and whether it fits your room. Reply 1, 2 or 3 and it puts that piece in your room and
texts back a picture of the room, plus a link to open it in 3D. Reply `undo` to take it out, `rooms` to list
your rooms and `room 2` to switch.

On iMessage it runs on [Photon 2.0](https://photon.codes/docs/beta/get-started/imessage) (`@photon-ai/api`):
it polls for received messages and replies with `sendMessage`, uploading pictures as attachments. For trying it
without an account it also opens Photon's terminal chat ([Spectrum](https://photon.codes/docs/spectrum-ts/introduction)).

## Run it

otto's backend (port 8000) and website (port 5173) must be running; the website draws the room pictures.

```sh
npm install
npm start
```

The terminal chat always opens, with no account needed. To answer on iMessage too, put your Photon 2.0
project ID and a project API key with message access in otto's `.env`:

```
Photon_Project_ID=pho_prj_...
Photon_FULL_API_KEY=pho_sk_...
```

(`PHOTON_PROJECT_ID` / `PHOTON_API_KEY` work too.) Then text the project's iMessage line from the phone
number assigned to it.

To give the line otto's name and picture ("Otto Your personal interior agent", with `assets/otto-avatar.png`):

```sh
npm run profile
```

Optional settings, also in `.env`:

- `OTTO_TERMINAL=off`: skip the terminal chat window, so iMessage activity and errors print plainly
- `OTTO_LOOKBACK_SECONDS`: on start, also answer messages from this many seconds ago (default 5)

- `OTTO_ROOM`: the room new chats start in (default `demo-living-room`)
- `OTTO_API_URL`: otto's backend (default `http://localhost:8000`)
- `OTTO_PUBLIC_URL`: where the "Open it in 3D" links point. Use a public address for phones (default `http://localhost:5173`).

## Tests

```sh
npm test
```

`src/conversation.ts` holds the whole conversation as plain functions with otto's API passed in, so it's
tested without Photon or a network. `src/main.ts` connects it to Spectrum.
