# otto on Photon

Text otto a photo of a piece of furniture. It replies with the closest pieces from the shop, each with a
picture, price, size and whether it fits your room. Reply 1, 2 or 3 and it puts that piece in your room and
texts back a picture of the room, plus a link to open it in 3D. Reply `undo` to take it out, `rooms` to list
your rooms and `room 2` to switch.

Built on [Photon Spectrum](https://photon.codes/docs/spectrum-ts/introduction): one agent loop for the
terminal and iMessage.

## Run it

otto's backend (port 8000) and website (port 5173) must be running; the website draws the room pictures.

```sh
npm install
npm start
```

Without Photon keys this opens Photon's terminal chat, so you can try it with no account. To answer on
iMessage too, add your Photon project's keys to otto's `.env`:

```
SPECTRUM_PROJECT_ID=pho_prj_...
SPECTRUM_PROJECT_SECRET=...
```

Optional settings, also in `.env`:

- `OTTO_ROOM`: the room new chats start in (default `demo-living-room`)
- `OTTO_API_URL`: otto's backend (default `http://localhost:8000`)
- `OTTO_PUBLIC_URL`: where the "Open it in 3D" links point. Use a public address for phones (default `http://localhost:5173`).

## Tests

```sh
npm test
```

`src/conversation.ts` holds the whole conversation as plain functions with otto's API passed in, so it's
tested without Photon or a network. `src/main.ts` connects it to Spectrum.
