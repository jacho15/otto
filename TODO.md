# TODO

Website work only. The video-to-room pipeline is being built on a separate branch. Its output (a room folder with `scene.json` and `meshes/*.glb`) is what the website loads.

## Done
- [x] FastAPI room API: list rooms, get a room, move/rotate/delete pieces, serve model files
- [x] Overlap and wall checks (backend and frontend, same rules)
- [x] React 3D room editor: select, drag, Q/E rotate, Delete removes, red warnings, price total
- [x] Demo room with 5 IKEA pieces
- [x] Edit room size (m/ft); pieces left outside the walls get warnings
- [x] Scanned Lounge: a room reconstructed from a phone video

## New place (design a new home)
- [x] Create an empty blueprint room from typed width, depth and ceiling height (m or ft)
- [x] "Liked at the showroom" list: save IKEA pieces you like (picked from the catalog for now)
- [x] Claude design agent: lays out your liked pieces in the blueprint, finds free spots itself, keeps walkways, backs sofas and desks onto walls facing into the room, and may suggest extras within budget
- [x] Design tab in the room view, with the agent's explanation and the list of changes
- [x] Keep the agent's reply to 4 short sentences at most (the server cuts longer replies)

## 1. Shop
- [x] `catalog.json` with 5 IKEA products (title, URL, price, size W×D×H, photo)
- [x] Catalog panel in the room view: product cards with photo, price, size and shop link
- [x] "Add to room": place the product at its real size in the nearest free spot, then select it
- [x] "Replace": pick a piece in the room and swap in a product. The old piece shows as a faint ghost, and the new one takes its spot (nudged inside the walls if needed). Removing the new piece brings the old one back.
- [x] Shop fit badges (Fits / Taller than the ceiling / Bigger than the room / No free floor space), with sorting and "Only what fits"
- [x] 16 more IKEA products (stand-in shapes at real size)
- [ ] Saved products (wishlist) shared across all rooms

## 2. Add any furniture
- [x] Paste a product link: read name, price, photo and size from the page on the server (JSON-LD, Open Graph, sizes from the page text)
- [x] Upload a product photo plus a typed size, which becomes a sized stand-in shape
- [x] Upload a `.glb` 3D file, scaled to the typed size
- [ ] Upload `.obj/.stl/.ply` files too, and rescale cm/mm files when no size is given
- [x] Drag and drop photos, `.glb` files or links straight onto the 3D view
- [x] Block private and loopback addresses when downloading links (also redirects, NAT64, size and time limits)
- [x] "Your items": custom pieces you imported or uploaded, ready to add to any room

## 3. Fit tools
- [x] Snap to walls while dragging (with an on/off toggle)
- [x] Live distances from the selected piece to each wall
- [x] Live distances from the selected piece to the nearest furniture
- [x] Walkway warning when a gap is under 60 cm
- [x] Top view: true orthographic floor plan
- [x] Doorway check: "will it get through the door" (an estimate, per room door size)
- [x] Undo (every change, button or Ctrl/Cmd+Z), and saved layouts to compare (A/B with price totals)

## 4. Cheaper alternatives
- [x] For a selected piece, find cheaper products of the same type in the catalog
- [x] Fit-check each one without changing the room, and show price and savings
- [x] One click to swap an alternative in (uses Replace)
- [ ] Search beyond the catalog (other shops)

## 4b. "Goes well with" suggestions (GenAI)
Like "Frequently bought together", but for your room, and you see it live.
- [x] "Suggest with Claude" button: Claude looks at the room and the budget and picks a few catalog products that fit and match
- [x] Each suggestion uses the shop's model if we have one, else a sized stand-in shape
- [ ] Generate a 3D model from the product photo
- [x] Preview each suggestion live in the room at a free spot, as a ghost you can accept or skip
- [x] Show why each one was picked, its price, and whether it fits the spend mandate
- [x] Suggestions come from real product data (catalog), never invented prices

## 5. AI assistant (Claude)
- [x] Chat panel in the room view
- [x] Tools: read a product link, place, move, remove, check fit, find alternatives
- [x] Budget and style preferences, shown as removable chips
- [x] Room refreshes live after the assistant makes changes (and every change can be undone)
- [x] Treat page text as data: never follow instructions found on product pages (only parsed fields reach the assistant)

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
- [x] "Test room": an empty room of any size (1.5–15 m wide/deep, 2–4 m high), no upload needed (done as New place)
- [x] Optional toggle to show the scan's point cloud

## 8. Look and polish
- [ ] Better lighting: tone mapping, soft shadows, ambient occlusion, wood floor texture, a "Quality" toggle
- [ ] Render button: a photoreal still of the room
- [ ] Code-split the frontend bundle (currently 1.35 MB)

## 9. Later
- [x] Chrome extension: "Put in my room" from any product page (reads name, price, photo and size; falls back to reading the open page for shops that block servers)

## Known small issues
- [x] Backend allows deleting a piece the UI marks as not movable; make both sides agree (now 409)
- [ ] Totals add mixed currencies under one currency
- [ ] Backend lock only covers one server process
- [x] Error card always says to check port 8000, even for "room not found"
- [x] "Add to room" copies the model into the room's `meshes/` and edits `scene.json`, so testing on the demo room leaves changes in git. Point catalog pieces at the catalog's model file instead.
- [x] Deleting a piece while its Replace is in flight leaves the new piece with a `replaces` link to nothing (the dangling link is now dropped)
