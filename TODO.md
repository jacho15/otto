# TODO

Website work only. The video-to-room pipeline is being built on a separate branch. Its output (a room folder with `scene.json` and `meshes/*.glb`) is what the website loads.

## Done
- [x] FastAPI room API: list rooms, get a room, move/rotate/delete pieces, serve model files
- [x] Overlap and wall checks (backend and frontend, same rules)
- [x] React 3D room editor: select, drag, Q/E rotate, Delete removes, red warnings, price total
- [x] Demo room with 5 IKEA pieces

## 1. Shop
- [x] `catalog.json` with 5 IKEA products (title, URL, price, size W×D×H, photo)
- [x] Catalog panel in the room view: product cards with photo, price, size and shop link
- [x] "Add to room": place the product at its real size in the nearest free spot, then select it
- [x] "Replace": pick a piece in the room and swap in a product. The old piece shows as a faint ghost, and the new one takes its spot (nudged inside the walls if needed). Removing the new piece brings the old one back.
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

## 4b. "Goes well with" suggestions (GenAI)
Like "Frequently bought together", but for your room, and you see it live.
- [ ] "Suggest furniture" button: calls Claude with the room (size, pieces, style, gaps, budget) and gets back a few products that would fit and match
- [ ] Each suggestion gets a 3D model made automatically: the shop's own model if it has one, else one generated from the product photo, else a sized stand-in shape
- [ ] Preview each suggestion live in the room at a free spot, as a ghost you can accept (Add to room), skip, or swap
- [ ] Show why each one was picked, its price, and whether it fits the spend mandate
- [ ] Suggestions come from real product pages (catalog or scraped), never invented prices

## 5. AI assistant (Claude)
- [ ] Chat panel in the room view
- [ ] Tools: read a product link, place, move, remove, check fit, find alternatives
- [ ] Budget and style preferences, shown as removable chips
- [ ] Room refreshes live after the assistant makes changes
- [ ] Treat page text as data: never follow instructions found on product pages

## 6. Agentic checkout (Visa track)
- [x] Spend mandate set only by the user: per-item cap, order total cap, allowed shops (matched by URL host), expiry date; saving it issues a mock agent token
- [x] Claude checkout agent proposes an order from the room's products; the server fills in prices, never the model
- [x] Approval step: only the user's click approves, and the server re-checks the mandate, prices and items first
- [x] The agent has no tool that can change the mandate or approve an order
- [x] Mock payment that never claims a real purchase, behind a provider interface so a Visa API can be swapped in
- [x] "Why" line on each proposed item
- [ ] Totals per currency (caps assume one currency today)
- [ ] "Your data" panel (what is kept, how to delete it)

## 7. Rooms and pipeline hookup
- [ ] Upload a room video from the home page and show build progress (job polling)
- [ ] Room dimensions with the upload: the user types the measured width, depth and ceiling height (m or ft/in). Send them to the pipeline so it can lock the metric scale and fit the walls to a known rectangle instead of estimating them, which cuts GPU work. Use them as the walls if the scan's own fit disagrees by a lot, and show both.
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
- [ ] "Add to room" copies the model into the room's `meshes/` and edits `scene.json`, so testing on the demo room leaves changes in git. Point catalog pieces at the catalog's model file instead.
- [ ] Deleting a piece while its Replace is in flight leaves the new piece with a `replaces` link to nothing
