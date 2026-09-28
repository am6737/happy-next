import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ToolCall } from '@/sync/typesMessage';
import { knownTools } from '@/components/tools/knownTools';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { formatMCPTitle, formatMCPIcon } from './views/MCPToolView';

interface ToolHeaderProps {
    tool: ToolCall;
    maxWidth?: number;
}

/**
 * The title and subtitle `ToolHeader` shows, as plain strings, for headers that cannot take a
 * custom title view (the iOS soft header drops its edge effect and subtitle as soon as one is set).
 */
export function getToolHeaderText(tool: ToolCall): { title: string; subtitle: string | null } {
    const knownTool = knownTools[tool.name as keyof typeof knownTools] as any;

    // Handle optional title and function type
    let title = tool.name;
    if (knownTool?.title) {
        if (typeof knownTool.title === 'function') {
            title = knownTool.title({ tool, metadata: null });
        } else {
            title = knownTool.title;
        }
    }

    // Special handling for MCP tools
    if (tool.name.startsWith('mcp__') || tool.name.startsWith('mcp:')) {
        title = formatMCPTitle(tool);
    }

    // Extract subtitle using the same logic as ToolView
    let subtitle: string | null = null;
    if (tool.name !== 'view_image' && knownTool && typeof knownTool.extractSubtitle === 'function') {
        const extractedSubtitle = knownTool.extractSubtitle({ tool, metadata: null });
        if (typeof extractedSubtitle === 'string' && extractedSubtitle) {
            subtitle = extractedSubtitle;
        }
    }

    return { title, subtitle };
}

export function ToolHeader({ tool, maxWidth }: ToolHeaderProps) {
    const { theme } = useUnistyles();
    const knownTool = knownTools[tool.name as keyof typeof knownTools] as any;
    const { title: toolTitle, subtitle } = getToolHeaderText(tool);

    let icon = knownTool?.icon ? knownTool.icon(18, theme.colors.header.tint) : <Ionicons name="construct-outline" size={18} color={theme.colors.header.tint} />;
    if (tool.name.startsWith('mcp__') || tool.name.startsWith('mcp:')) {
        icon = formatMCPIcon(tool, 18, theme.colors.header.tint);
    }

    return (
        <View style={[styles.container, maxWidth ? { maxWidth } : undefined]}>
            <View style={styles.titleContainer}>
                <View style={styles.titleRow}>
                    {icon}
                    <Text style={styles.title} numberOfLines={1}>{toolTitle}</Text>
                </View>
                {subtitle && (
                    <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        flexGrow: 1,
        flexBasis: 0,
        paddingHorizontal: 4,
    },
    titleContainer: {
        flexDirection: 'column',
        alignItems: 'center',
        flexGrow: 1,
        flexBasis: 0
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    title: {
        fontSize: 14,
        fontWeight: '500',
        color: theme.colors.text,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 11,
        color: theme.colors.textSecondary,
        textAlign: 'center',
        marginTop: 2,
    },
}));
