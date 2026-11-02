// Numeric IDs and glosses are from the attributed FSL-105 v2 labels.csv.
// Display punctuation/casing is normalized; no signing instructions are invented.
export const referenceSource = {
  title: 'FSL-105 v2', author: 'Isaiah Jassen Tupal (2023)',
  url: 'https://data.mendeley.com/datasets/48y2y99mb9/2',
  license: 'https://creativecommons.org/licenses/by/4.0/',
  review: 'The authors report expert-selected vocabulary; SEACrowd describes expert-reviewed adult FSL signing. These research examples are not a complete curriculum or endorsement of this app.'
};
const greetings = ['Good morning', 'Good afternoon', 'Good evening', 'Hello', 'How are you', "I’m fine", 'Nice to meet you', 'Thank you', 'You’re welcome', 'See you tomorrow'];
const survival = ['Understand', 'Don’t understand', 'Know', 'Don’t know', 'No', 'Yes', 'Wrong', 'Correct', 'Slow', 'Fast'];
const numbers = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
export const references = [...greetings, ...survival, ...numbers].map((label, id) => ({
  id: `fsl105-${id}`, datasetId: id, label, glyph: id >= 20 ? String(id - 19) : label.slice(0, 1),
  category: id >= 20 ? 'numbers' : 'everyday', group: id < 10 ? 'Greetings' : id < 20 ? 'Everyday communication' : 'Numbers',
  status: 'source-reference', reference: `/references/fsl105-${id}.mp4`,
  recognitionSupported: id >= 20 && id <= 24
}));

// The alphabet and zero remain planning labels, not an invented FSL inventory.
export const candidates = [
  ...references,
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => ({ id: `draft-letter-${letter.toLowerCase()}`, label: `Letter ${letter}`, glyph: letter, category: 'alphabet', status: 'review-pending', reference: null })),
  { id: 'draft-number-0', label: 'Number 0', glyph: '0', category: 'numbers', status: 'review-pending', reference: null }
];
export const lexicon = { version: 'planning-1', approvedSignIds: [], authoritativeInventoryConfirmed: false };
