# Usage guide

[Back to the README](../README.md)

## Open and browse files

Use **Open…** or drop `.exar1` files onto the page. Files load in sequence;
progress appears at bottom right. A file already open is not loaded again, and
read errors appear in the red banner. Choose an open file from the dropdown.
A full backup can contain several trees (for example, `USER`); each appears as
a collapsible section, and search covers all trees.

Click a program to show its steps. Select steps by clicking, Ctrl/Cmd-click,
Shift-click, or using the arrow keys. Left/Right collapse or expand tree nodes.
Search filters tree, region, exam, program, and step names; matching steps are
highlighted. Escape clears the search.

Strategy and Decision forks show their branches below the choice, between
Split and Join; the default branch is marked. Copy references use numbered
tags: hover a tag to highlight its source and destinations and see what is
copied. Broken references are red and striped. Step facts show comments, tags,
body part, contrast agent, copy references, and problems. Click the Step facts
title to collapse it. Directory documents may contain passwords; only their
protected status is carried into the app's file model. Program warnings and
the **Problems** menu describe items the app could not read as expected.

Total TA is the sum of measurement-step TA values, without adjustment for
Introduction or triggering. Forked programs count the default branch of each
fork. The display notes steps without TA. If step order cannot be read, the app
shows steps by rank and reports that condition.

## Inspect a protocol

On a wide window outside split view, the panel beside the step list follows the
focused step. Tabs remain selected as focus changes; arrow keys move between
tabs.

| Tab | Contents |
| --- | --- |
| **Summary** | Main values as the scanner previews them, grouped by topic; hover a value for its parameter key and stored value. Also shows upgrade notes and add-in guidance and image count. |
| **Cards** | Reconstructed scanner protocol cards. Values without catalog wording are shown as stored and flagged; a note explains unreproduced lines or an approximated card set. |
| **XProtocol** | Protocol text without ASCCONV blocks. |
| **ASCCONV** | Stored `key = value` parameters in order, including sub-protocols. Filter by parameter name; Escape clears the filter. |
| **Add-in** | Add-in type and configuration as indented XML. Escaped XML is unpacked; values over 1000 characters are shortened and their length shown. |

Tabs that do not apply to a step may be absent. Add-in guidance indicates when
it is only the stock placeholder.

## Compare steps

Select two measurement steps in one list with Ctrl/Cmd-click, or select one in
each split-view pane to compare across files. Press **Compare steps** or
right-click the step list. The panel shows differences in protocol parameters
or scanner card lines; it does not need both steps to come from the same file.

In parameter comparison, `(absent = default)` means a parameter is left at its
default; `(no sub-protocol N)` means the sub-protocol itself is absent. Churn
parameters that change when a protocol is scanned and saved (such as coils,
adjustments, positions, and scan time), and ignored parameters, are hidden
until **Show churn/ignored** is selected. Cards mode shows differing lines by
tab and card, with `(no line)` when one side lacks a line; **Show all lines**
also includes matching lines. Escape or **Close** closes the panel. The chosen
comparison mode remains selected.

## Compare programs

Turn on split view, select two different programs (in the same or different
files), and choose **Compare programs** or right-click the tree. Steps and
forks are matched side by side. Markers mean:

| Marker | Meaning |
| --- | --- |
| `=` | Same |
| `≠` | Changed; differing fields are listed |
| `−` / `+` | Only in A / only in B |
| `↕` | Moved, for example into or out of a branch |

Forks have rows for split, condition, branches, and join. Unchanged runs are
collapsed until **Show unchanged** is selected. A measurement pair with
different protocols offers **Compare steps**. Escape or **Close** returns to
the panes (Escape closes an open step-comparison panel first). The program
comparison is a snapshot; run it again after choosing other programs.

## Analyze and report sequences

**Analyze** reads every protocol and add-in in the active pane's file. It is
also available from a file's right-click menu. Large exports can take a minute;
progress and **Cancel** appear beside the button. Cancel keeps completed work,
so a later Analyze reads the remainder. Files are queued in order, and Cancel
stops the queue. Results stay only while the page is open.

After analysis, marks identify steps, programs, exams, regions, and trees using
customer or unrecognised references; hover the flask icon for details. Add-in
boxes name their add-ins. Closing a file removes its analysis results and marks.

**Mark upgrade notes** in the header, off by default, also marks steps whose
protocols have upgrade notes, along with their programs, exams, regions, and
trees. Marked rows show an up-arrow icon and a bar on the right edge. Focus a
marked step to read its notes on the **Summary** tab. The choice lasts only
while the page is open.

Right-click an analyzed file and open **Customer sequences report** to list
references used by analyzed files. Groups are **Customer (upgrade risk)**
(`%CustomerSeq%`, `%CustomerEvaDefProt%`), **Unrecognised**, **Service**, and
**Standard**. Expand a reference to see its steps and select a step to show it
in the active pane. **By program** groups customer and unrecognised references
by program; **By reference** (the default) groups by reference.

**Not checked** lists steps with no protocol, not yet read (including when
analysis stopped early), unreadable, or without a named sequence. These entries
distinguish missing checks from a clean result. **Copy** copies rows as
tab-separated text; **Download CSV** saves a local CSV file. The report updates
after later analyses. Escape or **Close** closes it.

## Split view and closing files

Split view has two panes, each with its own file and selection. To close a file,
use the file dropdown or right-click in its pane and choose **Close file**.
