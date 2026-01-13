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

  tmpl.content.childNodes.forEach((newNode) => {
    const id = newNode.id;
    if (!id) return;
    const existingNode = wrapper.querySelector(`#${id}`);
    if (existingNode) {
      existingNode.replaceWith(newNode);
    } else {
      wrapper.appendChild(newNode);
    }
  });
  return tmpl.content;
}