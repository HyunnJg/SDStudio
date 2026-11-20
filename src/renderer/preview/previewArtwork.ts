// Original geometric illustration for UI review. This is not an AI generation.
const artwork = `<svg xmlns="http://www.w3.org/2000/svg" width="832" height="1216" viewBox="0 0 832 1216">
<defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#829d9d"/><stop offset="1" stop-color="#e7d6a5"/></linearGradient><linearGradient id="land" x2="0" y2="1"><stop stop-color="#3b6359"/><stop offset="1" stop-color="#162f35"/></linearGradient></defs>
<path fill="url(#sky)" d="M0 0h832v1216H0z"/><circle cx="595" cy="250" r="91" fill="#f9eac0"/>
<path d="M0 490 130 306 300 518 478 356 832 584v632H0z" fill="#64837c"/><path d="M0 632 238 474 402 643 636 497 832 598v618H0z" fill="#416960"/>
<path fill="url(#land)" d="M0 676q200-114 430-42t402-13v595H0z"/><path d="M450 680q-185 151-74 269t-82 267h282q202-163-13-289t-75-247z" fill="#c6b590"/>
<path d="M0 528v688h81V585zM832 500v716h-77V558z" fill="#203f3e"/>
<g fill="#294e45"><ellipse cx="51" cy="375" rx="139" ry="251"/><ellipse cx="799" cy="360" rx="135" ry="244"/></g>
<g fill="#3e6653"><ellipse cx="17" cy="306" rx="100" ry="160"/><ellipse cx="810" cy="284" rx="88" ry="161"/></g>
<path d="M173 827V710a244 244 0 0 1 488 0v117h-34V710a210 210 0 0 0-420 0v117z" fill="#afc0a1"/>
<g fill="#54725b"><circle cx="203" cy="639" r="22"/><circle cx="219" cy="587" r="22"/><circle cx="245" cy="552" r="19"/><circle cx="620" cy="631" r="25"/><circle cx="596" cy="573" r="24"/><circle cx="563" cy="541" r="18"/></g>
<g fill="#f5d196"><circle cx="216" cy="623" r="7"/><circle cx="242" cy="575" r="6"/><circle cx="605" cy="603" r="7"/><circle cx="574" cy="555" r="6"/></g>
<g><circle cx="379" cy="796" r="13" fill="#dbc4a0"/><path d="m366 813-12 71h47l-10-71z" fill="#a15b4b"/><path d="m368 882-2 42m25-42 3 42" stroke="#243a39" stroke-width="10"/>
<circle cx="446" cy="788" r="12" fill="#dbc4a0"/><path d="m434 804-10 68h45l-12-68z" fill="#597e8b"/><path d="m436 870-2 42m24-42 3 42" stroke="#243a39" stroke-width="10"/></g>
<g fill="#7a9973"><ellipse cx="72" cy="1067" rx="131" ry="65"/><ellipse cx="750" cy="1102" rx="151" ry="76"/></g>
<g fill="#e1b48a"><circle cx="49" cy="1045" r="8"/><circle cx="99" cy="1071" r="6"/><circle cx="717" cy="1078" r="8"/><circle cx="781" cy="1101" r="7"/></g>
</svg>`;

export default function previewArtwork(width = 832, height = 1216): string {
  const sized = artwork.replace(
    'width="832" height="1216"',
    `width="${width}" height="${height}"`,
  );
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
}
