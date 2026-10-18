# Otto: Put in my room

A Chrome extension. It sends the furniture on the page you are looking at to your Otto room.

## Install

1. Start the Otto server (http://localhost:8000) and the web app (http://localhost:5173).
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick this `extension/` folder.

## Use

1. Open a product page.
2. Click the Otto icon.
3. Check the title, price, type and size. Fix anything that is wrong.
4. Pick a room.
5. Click **Put in my room** to add it and open the room, or **Save to my items** to keep it for later.

If a shop blocks the server, the extension sends the page you are viewing instead.

## Settings

Click the gear to change the server address and the web app address. The defaults are
http://localhost:8000 and http://localhost:5173. The extension can only reach
http://localhost:8000 and http://127.0.0.1:8000. For another server address, add it to
`host_permissions` in `manifest.json` and reload the extension.
