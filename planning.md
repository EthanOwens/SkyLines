Things to update:
- Create a Settings menu, accessible through the account drop down
- Add the ability to color code notes and pages. 
  - In the settings page there should be an option to turn the automatic color grading off. By default it should be on. This should exist in an "aesthetics" subsection
    - There should be another option for how the color coding is displayed. Both are toggles. you can have both, 1 or neither on at the same time. By default it will just be the option 1 turned on.
      - Option 1 - bookend. There is just the column bookend to the left of the name
      - Option 2 - Highlight. A faded highlight of it's color over the whole name card
  - Whenever a new notesheet or page is made it should be given a color. The color should exist as the possible options listed above. There should be a default for the colors selection colors which can be changed as a part of the theme.



Bugs to fix:
- Relaunching the app while it's hidden in the tray does nothing. The single-instance callback in src-tauri/src/lib.rs is empty; it should call show_main_window(app) so launching from the Start menu/desktop brings the window back.
- Sticky notes never sync to Firestore. One account has 6 sticky notes still dirty since mid-September while its notes and pages synced fine. Push runs sticky notes last and aborts on the first non-"invalid-argument" error. Likely cause: the deployed Firestore rules predate stickyNotes (check the Firebase console against firestore.rules).
- Pages can fail to restore on a fresh database ("FOREIGN KEY constraint failed" in lib/sync/pull.ts). Each collection has its own pull listener, so a page can arrive before its note exists, and the error skips the rest of that batch. Restarting fixes it. Pull should apply parents (notebooks, folders, notes) before pages, or retry pages whose note is missing.