Things to add:
- Auto bullet formatting when you have something like a "-" next to something then hitting enter should make another "-" on the next line like bullets. Should also have support for tabs and shift + tab changing the tab formatting.
- The custom theme formatter is a bit cluttered, many of the options aren't distinct on what they do and many aren't on anything in the display gui template. 
  - Add organization and ensure everything listed is a genuine visible change that we can see on the gui template (add it if it can be shown there, or remove it if it can't)\
-  In text boxes have a faded timestamp of last edit for that text box (as shortform date and time)
   -  Include a longer form date for the last edit under the title (add a fixed length line under the page title and put the date/time stamp under the line) 
      -  (EX: Wednesday, January 14, 2026   2:55 PM)
-  Add sticky notes option. I want the ability to open a sticky note from the main gui. 
Functionality:
   - The sticky note should be a 9x16 aspect ratio pop out window.
   - It should be embeddable into text form. Meaning if you ctrl + k (link keybind, usually used for adding a hyperlink embedded into a word(s), but in this app should allow the option to create new or bind a sticky note) it will let you embed a sticky note that will pop up when the embed is clicked (this should work from a sticky note too, meaning I should be able to embed a sticky note inside a sticky note).
   - Sticky notes should have the following gui that should appear on focusing on the window and dissappear when unfocused:
     - Bottom bar should have basic text modifications (bold, italic, underline, strike through, bullets, check boxes (like bullets, but button next to line that auto strikes through the line when clicked))
     - Top bar should have option to pin (make the note stay in the foreground, aka displays over other windows), exit (auto-saves when closed and modified), and 3 dots drop down menu (should include option to delete note, and change the top bar color)
     - Top bar color should be by default based on the theme. It should minimize (shrink in height) as well when not focused
   - Sticky note main button should be on far right of the ribbon where File, Format, and Draw are.
     - Clicking this should make a sticky note home page pop up that lets you see a list of notes (preview of collapsed notes), screenshot (auto-screenshots the selected window and lets you double click to make this a new sticky note, where you can click to open the screenshot and draw on it)
   - Should have the option to make a new sticky note from the menu to embed when highlighting texts for formatting options
- All text areas should support bullet detection. When adding a "-" and pressing space after it should assume this is denoting a bullet. this should allow for bullet functionality of Enter/new line making a new bullet, tab indenting bullet, Shift + tab OR Backspace de-indenting bullet. This should work inside Sticky Notes