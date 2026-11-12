# Page feature map (public/index.html)

Driven by hand in Chrome against a `--keep` server. After the API checks, the sea holds 2 fish (the emoji one and "reef version 2.0 is up").

| Feature | Entry point | Action | Expected |
|---|---|---|---|
| Load | `/` | open | HUD `#nAll` = 2, status dot "live", no console errors |
| Release | textbox "Write a sentence" (`#msg`), button "↗ release" (`#go`) | type, click (or Enter) | toast "Released. Everyone who visits this sea can see it now.", `#nAll` +1, `#nMine` = 1, button disabled ~15 s, `#count` resets to 0/60 |
| Refused | same | type `see www.x.com`, release | toast starts "Links, emails and phone numbers…", the creature leaves at once |
| Counter | `#msg` | type | `#count` shows code-point length / 60 |
| Field guide | button "Field guide ·" (`#guideBtn`) | click, then "close ×" | `#guide` opens/closes, `aria-expanded` toggles, focus returns to the button |
| Read a creature | click a creature on `#ui` canvas | click | its sentence and species card show; the guide count goes up |
| Report | creature card → report | confirm dialog | toast "Reported. Thanks for keeping the sea kind." Don't accept native dialogs through Claude in Chrome; ask the user, or check report through the API instead |

Failure conditions: status "error" (API unreachable), a HUD count that matches the live site (wrong server), canvas blank (three.js failed to load: check the console and network).
