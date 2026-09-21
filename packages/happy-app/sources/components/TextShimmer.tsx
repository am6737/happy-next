import * as React from 'react';
import { Text, TextStyle } from 'react-native';

/**
 * A line of text with a band of light travelling across it, for something that is still working.
 *
 * Native renders the text plainly. The web implementation is the one that sweeps — see
 * TextShimmer.web.tsx — and only a folded turn's line asks for this, which is a web-only thing to
 * begin with. This file exists so the shared component that draws that line can import one name.
 */
export const TextShimmer = React.memo((props: {
    children: React.ReactNode;
    style?: TextStyle | TextStyle[];
    /** Unused here; the web implementation needs them to build the gradient. */
    baseColor?: string;
    highlightColor?: string;
}) => {
    return <Text style={props.style} numberOfLines={1}>{props.children}</Text>;
});
