/* Decorative PokeAPI sprites framing the page — pointer-events none via CSS */
(function () {
  if (document.querySelector('.poke-frame')) return;
  var SPRITE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
  // Classic cute: Bulbasaur, Charmander, Squirtle, Pikachu, Clefairy, Jigglypuff,
  // Meowth, Psyduck, Eevee, Snorlax, Magikarp, Mew, Chikorita, Cyndaquil, Totodile, Togepi
  var ids = [1, 4, 7, 25, 35, 39, 52, 54, 133, 143, 129, 151, 152, 155, 158, 175];
  var frame = document.createElement('div');
  frame.className = 'poke-frame';
  frame.setAttribute('aria-hidden', 'true');

  function place(id, style) {
    var img = document.createElement('img');
    img.src = SPRITE + id + '.png';
    img.alt = '';
    Object.keys(style).forEach(function (k) { img.style[k] = style[k]; });
    frame.appendChild(img);
  }

  // Left edge
  var left = [1, 4, 25, 133, 39, 152, 54, 175];
  left.forEach(function (id, i) {
    place(id, { left: '8px', top: (6 + i * 11.5) + '%' });
  });
  // Right edge
  var right = [7, 143, 35, 129, 155, 52, 158, 151];
  right.forEach(function (id, i) {
    place(id, { right: '8px', top: (8 + i * 11.5) + '%' });
  });
  // Top row
  [25, 1, 4, 7, 133].forEach(function (id, i) {
    place(id, { top: '6px', left: (18 + i * 16) + '%' });
  });
  // Bottom row
  [39, 143, 129, 151, 175].forEach(function (id, i) {
    place(id, { bottom: '6px', left: (18 + i * 16) + '%' });
  });

  document.body.prepend(frame);
})();
