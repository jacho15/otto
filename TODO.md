# TODO

Website work only. The video-to-room pipeline is being built on a separate branch. Its output (a room folder with `scene.json` and `meshes/*.glb`) is what the website loads.

## Done
- [x] FastAPI room API: list rooms, get a room, move/rotate/delete pieces, serve model files
- [x] Overlap and wall checks (backend and frontend, same rules)
- [x] React 3D room editor: select, drag, Q/E rotate, Delete removes, red warnings, price total
- [x] Demo room with 5 IKEA pieces

## 1. Shop
- [ ] `catalog.json` with the 5 IKEA items (title, URL, price, size W×D×H, model file, photo)
- [ ] Catalog panel in the room view: product cards with photo, price, size and shop link
- [ ] "Add to room": place the product at its real size in the nearest free spot, then select it
- [ ] "Replace": pick a piece in the room and swap in a product. The old piece shows as a faint ghost, and the new one takes its spot against the same wall. Removing the new piece brings the old one back.
- [ ] Saved products (wishlist) shared across all rooms

## 2. Add any furniture
- [ ] Paste a product link: read name, price, photos and size from the page on the server (JSON-LD, Open Graph, Shopify)
- [ ] Upload product photos plus a typed size, which becomes a sized stand-in shape
- [ ] Upload a 3D file (`.glb/.obj/.stl/.ply`), rescaling cm/mm files when no size is given
- [ ] Drag and drop photos, files or links straight onto the 3D view
- [ ] Block private and loopback addresses when downloading links

## 3. Fit tools
- [ ] Snap to walls while dragging (with an on/off toggle)
- [ ] Live distances from the selected piece to each wall and the nearest furniture
- [ ] Walkway warning when a gap is under 60 cm
- [ ] Top view: true orthographic floor plan
- [ ] Doorway check: "will it get through the door"
- [ ] Undo, and saved layouts to compare (A/B with price totals)

## 4. Cheaper alternatives
- [ ] For a selected piece, search for similar products that cost less
- [ ] Fit-check each one without changing the room, and show price and savings
- [ ] One click to swap an alternative in (uses Replace)

## 5. AI assistant (Claude)
- [ ] Chat panel in the room view
- [ ] Tools: read a product link, place, move, remove, check fit, find alternatives
- [ ] Budget and style preferences, shown as removable chips
- [ ] Room refreshes live after the assistant makes changes
- [ ] Treat page text as data: never follow instructions found on product pages

## 6. Agentic checkout (Visa track)
- [ ] Spend mandate set only by the user: per-item price cap, allowed shops (matched by URL host), expiry date
- [ ] Order panel: cart from the room's products, totals per currency
- [ ] Approval step: the agent proposes an order, and only the user's click approves it
- [ ] The agent has no tool that can change the mandate or approve an order
- [ ] Mock payment that never claims a real purchase. Structure it so a Visa API can be swapped in.
- [ ] Refuse prices that don't come from a real product page when a cap is set
- [ ] "Why" line on each recommendation, and a "Your data" panel (what is kept, how to delete it)

## 7. Rooms and pipeline hookup
- [ ] Upload a room video from the home page and show build progress (job polling)
- [ ] Hook up the pipeline branch's output once it is ready
- [ ] "Test room": an empty room of any size (1.5–15 m wide/deep, 2–4 m high), no upload needed
- [ ] Optional toggle to show the scan's point cloud

## 8. Look and polish
- [ ] Better lighting: tone mapping, soft shadows, ambient occlusion, wood floor texture, a "Quality" toggle
- [ ] Render button: a photoreal still of the room
- [ ] Code-split the frontend bundle (currently 1.35 MB)

## 9. Later
- [ ] Chrome extension: "Put in my room" from any product page (reads name, price, photos and size)

## Known small issues
- [ ] Backend allows deleting a piece the UI marks as not movable; make both sides agree
- [ ] Totals add mixed currencies under one currency
- [ ] Backend lock only covers one server process
- [ ] Error card always says to check port 8000, even for "room not found"
