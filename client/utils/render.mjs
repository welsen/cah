import hb from 'https://cdn.jsdelivr.net/npm/handlebars@4.7.8/+esm';

function removeChildren(wrapper) {
  while (wrapper.firstChild) {
    wrapper.removeChild(wrapper.firstChild);
  }
}
function replaceChildren(wrapper, newContent) {
  removeChildren(wrapper);
  wrapper.appendChild(newContent);
}

export async function render(wrapper, templatePath, data = {}) {
  const templateText = await (await fetch(templatePath)).text();
  const template = hb.compile(templateText);
  const tmpl = document.createElement('template');
  tmpl.innerHTML = template(data);

  replaceChildren(wrapper, tmpl.content);
  return tmpl.content;
}

export async function update(wrapper, templatePath, data = {}) {
  const templateText = await (await fetch(templatePath)).text();
  const template = hb.compile(templateText);
  const tmpl = document.createElement('template');
  tmpl.innerHTML = template(data);

  function isText(node) {
    return node && node.nodeType === Node.TEXT_NODE;
  }

  function visibleChildren(node) {
    // Filter out comments and whitespace-only text nodes to avoid spurious diffs
    return Array.from(node.childNodes).filter((n) => {
      if (n.nodeType === Node.COMMENT_NODE) return false;
      if (n.nodeType === Node.TEXT_NODE) return /\S/.test(n.textContent || '');
      return true;
    });
  }

  function isOpenDialog(node) {
    return node && node.nodeName === 'DIALOG' && node.open === true;
  }

  function attrsToMap(el) {
    const map = {};
    if (!el || !el.attributes) return map;
    for (let i = 0; i < el.attributes.length; i++) {
      const a = el.attributes[i];
      map[a.name] = a.value;
    }
    return map;
  }

  function syncAttributes(target, source) {
    const sourceAttrs = attrsToMap(source);
    const targetAttrs = attrsToMap(target);

    // Add/update attributes from source
    for (const [name, val] of Object.entries(sourceAttrs)) {
      if (target.getAttribute(name) !== val) target.setAttribute(name, val);
    }
    // Remove attributes not present in source, but preserve locally-open dialogs' open attribute
    for (const name of Object.keys(targetAttrs)) {
      if (!(name in sourceAttrs)) {
        if (name === 'open' && target.nodeName === 'DIALOG' && target.open) continue;
        target.removeAttribute(name);
      }
    }
  }

  function nodesEqual(a, b) {
    // Different node types
    if (a.nodeType !== b.nodeType) return false;

    // Text nodes: compare content
    if (isText(a) && isText(b)) return a.textContent === b.textContent;

    // Different tag names
    if (a.nodeName !== b.nodeName) return false;

    // Attributes must match exactly
    const aAttrs = attrsToMap(a);
    const bAttrs = attrsToMap(b);
    const aKeys = Object.keys(aAttrs);
    const bKeys = Object.keys(bAttrs);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (aAttrs[k] !== bAttrs[k]) return false;
    }

    // Children: deep recursive comparison but only visible children
    const aChildren = visibleChildren(a);
    const bChildren = visibleChildren(b);
    if (aChildren.length !== bChildren.length) return false;
    for (let i = 0; i < aChildren.length; i++) {
      if (!nodesEqual(aChildren[i], bChildren[i])) return false;
    }

    return true;
  }

  function mergeChildren(existing, incoming, {preserveOpen = false} = {}) {
    const incChildren = visibleChildren(incoming);
    let existingChildren = visibleChildren(existing);

    for (let i = 0; i < incChildren.length; i++) {
      const incChild = incChildren[i];
      const key = incChild.id;

      // 1) Id match within existing
      if (key) {
        const existingChildById = existing.querySelector(`#${key}`);
        if (existingChildById) {
          patchNode(existingChildById, incChild);
          continue;
        }
        const elsewhere = document.querySelector(`#${key}`);
        if (elsewhere) {
          existing.appendChild(elsewhere);
          patchNode(elsewhere, incChild);
          continue;
        }
      }

      // 2) Best candidate by nodeName and node type (text vs element)
      let candidateIdx = -1;
      for (let j = 0; j < existingChildren.length; j++) {
        const c = existingChildren[j];
        if (preserveOpen && isOpenDialog(c)) continue;
        if (c.nodeName === incChild.nodeName && isText(c) === isText(incChild)) {
          candidateIdx = j;
          break;
        }
      }

      if (candidateIdx !== -1) {
        const candidate = existingChildren.splice(candidateIdx, 1)[0];
        patchNode(candidate, incChild);
        continue;
      }

      // 3) Reuse document-wide node by id
      if (incChild.id) {
        const elsewhere = document.querySelector(`#${incChild.id}`);
        if (elsewhere) {
          existing.appendChild(elsewhere);
          patchNode(elsewhere, incChild);
          continue;
        }
      }

      // 4) Append unless an equivalent exists already
      const already = visibleChildren(existing).some(ec => nodesEqual(ec, incChild));
      if (!already) existing.appendChild(incChild.cloneNode(true));
    }
  }

  function patchNode(existing, incoming) {
    // If identical, nothing to do
    if (nodesEqual(existing, incoming)) return;

    // If existing node is an open <dialog> and incoming is a <dialog>, merge children and preserve open state
    if (isOpenDialog(existing) && incoming.nodeName === 'DIALOG') {
      // Sync attributes but preserve the local open state
      syncAttributes(existing, incoming);
      // Merge incoming children into existing without removing any local nodes to avoid closing user's dialog
      mergeChildren(existing, incoming, {preserveOpen: true});
      return;
    }

    // If different types or different tag names, try to avoid replacing the whole node
    if (existing.nodeType !== incoming.nodeType || existing.nodeName !== incoming.nodeName) {
      const parent = existing.parentNode;
      // If no parent (disconnected), we can't insert; fall back to replace
      if (!parent) {
        existing.replaceWith(incoming.cloneNode(true));
        return;
      }

      const doc = existing.ownerDocument || document;

      // Helper: find first id in incoming subtree
      const firstIncWithId = incoming.querySelector ? incoming.querySelector('[id]') : null;

      // 1) If incoming itself has an id and there's a node elsewhere with that id, move it and patch
      if (incoming.id) {
        const elsewhere = doc.querySelector(`#${incoming.id}`);
        if (elsewhere && elsewhere !== existing) {
          parent.insertBefore(elsewhere, existing);
          patchNode(elsewhere, incoming);
          return;
        }
      }

      // 2) If a descendant of incoming has an id that exists elsewhere, move & patch that descendant
      if (firstIncWithId && firstIncWithId.id) {
        const found = doc.querySelector(`#${firstIncWithId.id}`);
        if (found && found !== existing) {
          parent.insertBefore(found, existing);
          patchNode(found, incoming);
          return;
        }
      }

      // 3) If existing already contains some of incoming's descendants (by id), merge missing children into existing instead of replacing
      const incIds = incoming.querySelectorAll ? Array.from(incoming.querySelectorAll('[id]')).map(n => n.id).filter(Boolean) : [];
      const hasOverlap = incIds.some((id) => !!existing.querySelector(`#${id}`));
      if (hasOverlap) {
        mergeChildren(existing, incoming);
        return;
      }

      // 4) As a last-resort non-destructive fallback, insert the incoming element before the existing one
      parent.insertBefore(incoming.cloneNode(true), existing);
      return;
    }

    // Text node: update text
    if (isText(existing) && isText(incoming)) {
      if (existing.textContent !== incoming.textContent) existing.textContent = incoming.textContent;
      return;
    }

    // Sync attributes
    syncAttributes(existing, incoming);

    // Children: try keyed updates by id, otherwise by index
    const existingChildren = visibleChildren(existing);
    const incomingChildren = visibleChildren(incoming);

    // Map existing children by id when possible
    const existingById = new Map();
    const unmatchedExisting = [];
    existingChildren.forEach((child) => {
      if (child.id) existingById.set(child.id, child);
      else unmatchedExisting.push(child);
    });

    let nextExistingIndex = 0; // pointer for unmatchedExisting

    for (let i = 0; i < incomingChildren.length; i++) {
      const inc = incomingChildren[i];
      const key = inc.id;
      const refNode = existingChildren[i] || null;

      if (key && existingById.has(key)) {
        const matched = existingById.get(key);
        // Ensure correct order
        if (existingChildren[i] !== matched) existing.insertBefore(matched, refNode);
        patchNode(matched, inc);
        existingById.delete(key);
      } else if (!key && unmatchedExisting.length > 0) {
        // Try to find the best candidate among unmatched existing nodes with same nodeName
        let candidateIndex = -1;
        for (let j = 0; j < unmatchedExisting.length; j++) {
          const c = unmatchedExisting[j];
          if (c.nodeName === inc.nodeName && isText(c) === isText(inc)) {
            candidateIndex = j;
            break;
          }
        }

        if (candidateIndex !== -1) {
          const candidate = unmatchedExisting.splice(candidateIndex, 1)[0];
          // Ensure correct DOM order
          if (existing.childNodes[i] !== candidate) existing.insertBefore(candidate, refNode);
          patchNode(candidate, inc);
        } else if (inc.id) {
          // Look for a matching descendant by id elsewhere in the subtree
          const descendant = existing.querySelector(`#${inc.id}`);
          if (descendant) {
            if (existing.childNodes[i] !== descendant) existing.insertBefore(descendant, refNode);
            patchNode(descendant, inc);
          } else {
            existing.insertBefore(inc.cloneNode(true), refNode);
          }
        } else {
          // No suitable candidate: if the incoming has an id try to reuse existing node in document; otherwise avoid cloning deep-equals
          if (inc.id) {
            const elsewhere = document.querySelector(`#${inc.id}`);
            if (elsewhere) {
              existing.insertBefore(elsewhere, refNode);
              patchNode(elsewhere, inc);
            } else {
              const already = visibleChildren(existing).some(ec => nodesEqual(ec, inc));
              if (!already) existing.insertBefore(inc.cloneNode(true), refNode);
            }
          } else {
            const already = visibleChildren(existing).some(ec => nodesEqual(ec, inc));
            if (!already) existing.insertBefore(inc.cloneNode(true), refNode);
          }
        }
      } else {
        // No matching existing node, insert clone at the right position
        existing.insertBefore(inc.cloneNode(true), refNode);
      }
    }

    // Remove any existing nodes that were keyed but not present in incoming
    for (const leftover of existingById.values()) {
      if (isOpenDialog(leftover)) continue;
      leftover.remove();
    }

    // Remove extra unmatched existing nodes past incoming length (visible children), but avoid removing open dialogs
    let curVisible = visibleChildren(existing);
    while (curVisible.length > incomingChildren.length) {
      // find first removable node beyond incomingChildren.length
      let removeIdx = -1;
      for (let k = incomingChildren.length; k < curVisible.length; k++) {
        if (!isOpenDialog(curVisible[k])) {
          removeIdx = k;
          break;
        }
      }
      if (removeIdx === -1) break; // nothing removable
      curVisible[removeIdx].remove();
      curVisible = visibleChildren(existing);
    }
  }

  // Iterate new top-level nodes and patch/insert as needed
  const newChildren = visibleChildren(tmpl.content);
  const existingTopChildren = visibleChildren(wrapper);

  for (let i = 0; i < newChildren.length; i++) {
    const newNode = newChildren[i];
    const id = newNode.id;

    if (id) {
      // Prefer node in wrapper, but fall back to document-wide search to find and reuse dialogs that may have been moved/opened
      let existingNode = wrapper.querySelector(`#${id}`);
      if (!existingNode) existingNode = document.querySelector(`#${id}`);
      if (existingNode) {
        // If the node exists but isn't a child of wrapper, move it into the right position
        const desiredRef = existingTopChildren[i] || null;
        if (existingNode.parentNode !== wrapper) wrapper.insertBefore(existingNode, desiredRef);
        patchNode(existingNode, newNode);
        continue;
      }
      // not found by id, fallthrough to attempt index-based insert
    }

    let existingAtIndex = existingTopChildren[i];
    // If there's an open dialog at this index, skip it and find the next non-dialog to attempt to patch against
    if (isOpenDialog(existingAtIndex)) {
      existingAtIndex = null;
      for (let j = i; j < existingTopChildren.length; j++) {
        if (!isOpenDialog(existingTopChildren[j])) {
          existingAtIndex = existingTopChildren[j];
          break;
        }
      }
    }

    if (existingAtIndex) {
      // if same node type/name and no id collision, patch in place
      if (!newNode.id && existingAtIndex.nodeName === newNode.nodeName && isText(existingAtIndex) === isText(newNode)) {
        patchNode(existingAtIndex, newNode);
      } else if (newNode.id && existingAtIndex.id === newNode.id) {
        patchNode(existingAtIndex, newNode);
      } else {
        // Try to find a later sibling that matches, to avoid replacing/insert-heavy updates
        let foundIdx = -1;
        for (let j = i + 1; j < existingTopChildren.length; j++) {
          const candidate = existingTopChildren[j];
          if (isOpenDialog(candidate)) continue; // skip open dialogs
          if (candidate.nodeName === newNode.nodeName && isText(candidate) === isText(newNode)) {
            foundIdx = j;
            break;
          }
        }
        if (foundIdx !== -1) {
          const candidate = existingTopChildren.splice(foundIdx, 1)[0];
          if (wrapper.childNodes[i] !== candidate) wrapper.insertBefore(candidate, existingAtIndex);
          patchNode(candidate, newNode);
        } else {
          // insert newNode before existingAtIndex if no candidate found
          wrapper.insertBefore(newNode.cloneNode(true), existingAtIndex);
        }
      }
    } else {
      // nothing at this index, append
      wrapper.appendChild(newNode.cloneNode(true));
    }
  }

  // Remove any extra visible nodes in wrapper beyond incoming children but keep open dialogs
  let finalVisible = visibleChildren(wrapper);
  while (true) {
    const nonDialog = finalVisible.filter(n => !isOpenDialog(n));
    if (nonDialog.length <= newChildren.length) break;
    // remove the last non-dialog node
    let idx = -1;
    for (let k = finalVisible.length - 1; k >= 0; k--) {
      if (!isOpenDialog(finalVisible[k])) {
        idx = k; break;
      }
    }
    if (idx === -1) break;
    finalVisible[idx].remove();
    finalVisible = visibleChildren(wrapper);
  }

  return tmpl.content;
}
