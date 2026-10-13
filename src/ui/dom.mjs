export function element(tagName, options = {}, children = []) {
  const node = document.createElement(tagName);

  if (options.className) {
    node.className = options.className;
  }
  if (options.text !== undefined) {
    node.textContent = String(options.text);
  }
  if (options.attributes) {
    for (const [name, value] of Object.entries(options.attributes)) {
      if (value !== null && value !== undefined) {
        node.setAttribute(name, String(value));
      }
    }
  }
  if (options.dataset) {
    for (const [name, value] of Object.entries(options.dataset)) {
      node.dataset[name] = String(value);
    }
  }
  if (options.on) {
    for (const [eventName, listener] of Object.entries(options.on)) {
      node.addEventListener(eventName, listener);
    }
  }

  for (const child of Array.isArray(children) ? children : [children]) {
    if (child !== null && child !== undefined) {
      node.append(child);
    }
  }
  return node;
}

export function button(text, options = {}, children = []) {
  const node = element('button', {
    ...options,
    text,
    attributes: {
      type: 'button',
      ...(options.attributes || {}),
    },
  });
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child !== null && child !== undefined) {
      node.append(child);
    }
  }
  return node;
}

export function clearNode(node) {
  node.replaceChildren();
}
