import test from 'node:test';
import assert from 'node:assert/strict';

import { ASSISTANT_SEGMENT_MARKER, ASSISTANT_SENTENCE_MARKER } from '../../js/chat/constants.js';
import { createMarkerStreamSplitter } from '../../js/chat/core/marker-stream-splitter.js';

test('marker splitter handles markers across chunk boundaries', () => {
    const splitter = createMarkerStreamSplitter({
        markers: [ASSISTANT_SEGMENT_MARKER, ASSISTANT_SENTENCE_MARKER]
    });

    assert.deepEqual(splitter.push(`hello${ASSISTANT_SENTENCE_MARKER.slice(0, 6)}`), []);
    const completed = splitter.push(
        `${ASSISTANT_SENTENCE_MARKER.slice(6)}world${ASSISTANT_SEGMENT_MARKER}again`
    );

    assert.deepEqual(completed, ['hello', 'world']);
    assert.equal(splitter.flush(), 'again');
});

test('marker splitter ignores empty segments for adjacent markers', () => {
    const splitter = createMarkerStreamSplitter({
        markers: [ASSISTANT_SEGMENT_MARKER, ASSISTANT_SENTENCE_MARKER]
    });

    const completed = splitter.push(
        `${ASSISTANT_SENTENCE_MARKER}A${ASSISTANT_SEGMENT_MARKER}${ASSISTANT_SENTENCE_MARKER}B${ASSISTANT_SENTENCE_MARKER}`
    );

    assert.deepEqual(completed, ['A', 'B']);
    assert.equal(splitter.flush(), '');
});

test('marker splitter can discard remainder', () => {
    const splitter = createMarkerStreamSplitter({
        markers: [ASSISTANT_SEGMENT_MARKER, ASSISTANT_SENTENCE_MARKER]
    });

    splitter.push('partial text');
    splitter.discardRemainder();

    assert.equal(splitter.flush(), '');
});

test('marker splitter drops stray leading sentence punctuation', () => {
    const splitter = createMarkerStreamSplitter({
        markers: [ASSISTANT_SEGMENT_MARKER, ASSISTANT_SENTENCE_MARKER]
    });

    const completed = splitter.push(
        `first${ASSISTANT_SENTENCE_MARKER}\u3002second${ASSISTANT_SENTENCE_MARKER}`
    );

    assert.deepEqual(completed, ['first', 'second']);
    assert.equal(splitter.flush(), '');
});
