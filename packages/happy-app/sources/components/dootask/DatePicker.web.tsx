import * as React from 'react';
import { DayPicker } from 'react-day-picker';
import { ca, enUS, es, it, ja, pl, pt, ru, zhCN, zhTW } from 'react-day-picker/locale';
import type { Locale } from 'react-day-picker';
import { useUnistyles } from 'react-native-unistyles';
import { getCurrentLanguage, type SupportedLanguage } from '@/text';
import type { DatePickerProps } from './DatePicker';
import 'react-day-picker/style.css';
import './DatePicker.web.css';

// Web: the native picker's wheels are made for touch, so on web the calendar is react-day-picker
// and the time is two lists of hours and minutes that scroll with the mouse wheel and pick on click.

const LOCALES: Record<SupportedLanguage, Locale> = {
    en: enUS,
    ru,
    pl,
    es,
    it,
    pt,
    ca,
    ja,
    'zh-Hans': zhCN,
    'zh-Hant': zhTW,
};

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

const pad = (value: number) => String(value).padStart(2, '0');

/** `minDate` rounded up to the next whole minute, the earliest time the picker can hold. */
function earliestOf(minDate?: Date): Date | null {
    if (!minDate) return null;
    const earliest = new Date(minDate);
    if (earliest.getSeconds() > 0 || earliest.getMilliseconds() > 0) {
        earliest.setSeconds(0, 0);
        earliest.setMinutes(earliest.getMinutes() + 1);
    }
    return earliest;
}

const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

type TimeColumnProps = {
    values: number[];
    selected: number;
    isDisabled: (value: number) => boolean;
    onSelect: (value: number) => void;
};

/** A scrollable list that opens on the selected value; the wheel scrolls it and a click picks. */
const TimeColumn = React.memo(function TimeColumn({ values, selected, isDisabled, onSelect }: TimeColumnProps) {
    const columnRef = React.useRef<HTMLDivElement>(null);
    const placed = React.useRef(false);
    // Set by a click on this list: the clicked value is already under the pointer, so the list
    // must not scroll it away. Only changes made elsewhere (a day pick, clamping) re-center it.
    const pickedHere = React.useRef(false);

    // Center the selected value: instantly the first time, smoothly after that.
    React.useLayoutEffect(() => {
        if (pickedHere.current) {
            pickedHere.current = false;
            return;
        }
        const column = columnRef.current;
        const item = column?.querySelector<HTMLElement>('[aria-selected="true"]');
        if (!column || !item) return;
        column.scrollTo({
            top: item.offsetTop - (column.clientHeight - item.offsetHeight) / 2,
            behavior: placed.current ? 'smooth' : 'auto',
        });
        placed.current = true;
    }, [selected]);

    return (
        <div ref={columnRef} className="dp-time-col" role="listbox">
            {values.map((value) => (
                <button
                    key={value}
                    type="button"
                    role="option"
                    className="dp-time-item"
                    aria-selected={value === selected}
                    disabled={isDisabled(value)}
                    onClick={() => {
                        pickedHere.current = value !== selected;
                        onSelect(value);
                    }}
                >
                    {pad(value)}
                </button>
            ))}
        </div>
    );
});

export const DatePicker = React.memo(function DatePicker({ date, onChange, minDate, timePicker = true }: DatePickerProps) {
    const { theme } = useUnistyles();
    const locale = LOCALES[getCurrentLanguage()] ?? enUS;
    const earliest = earliestOf(minDate);

    // Picks never land before `minDate`: they snap to the earliest allowed time instead.
    const commit = React.useCallback((next: Date) => {
        onChange(earliest && next < earliest ? new Date(earliest) : next);
    }, [onChange, earliest?.getTime()]);

    const handleDay = React.useCallback((day: Date | undefined) => {
        if (!day) return;
        const next = new Date(day);
        next.setHours(date.getHours(), date.getMinutes(), 0, 0);
        commit(next);
    }, [date, commit]);

    const handleHour = React.useCallback((hour: number) => {
        const next = new Date(date);
        next.setHours(hour, date.getMinutes(), 0, 0);
        commit(next);
    }, [date, commit]);

    const handleMinute = React.useCallback((minute: number) => {
        const next = new Date(date);
        next.setHours(date.getHours(), minute, 0, 0);
        commit(next);
    }, [date, commit]);

    const onEarliestDay = earliest !== null && isSameDay(date, earliest);
    const isHourDisabled = React.useCallback(
        (hour: number) => onEarliestDay && hour < earliest!.getHours(),
        [onEarliestDay, earliest?.getTime()],
    );
    const isMinuteDisabled = React.useCallback(
        (minute: number) => onEarliestDay && date.getHours() === earliest!.getHours() && minute < earliest!.getMinutes(),
        [onEarliestDay, date, earliest?.getTime()],
    );

    const cssVars = {
        '--dp-text': theme.colors.text,
        '--dp-text-secondary': theme.colors.textSecondary,
        '--dp-primary': theme.colors.button.primary.background,
        '--dp-primary-text': theme.colors.button.primary.tint,
        '--dp-accent-bg': theme.colors.surfaceHighest,
        '--dp-border': theme.colors.divider,
    } as React.CSSProperties;

    return (
        <div className="dp-root" style={cssVars}>
            <div className="dp-calendar">
                <DayPicker
                    mode="single"
                    locale={locale}
                    selected={date}
                    onSelect={handleDay}
                    defaultMonth={date}
                    disabled={earliest ? { before: earliest } : undefined}
                    animate
                />
            </div>
            {timePicker && (
                <div className="dp-time">
                    <TimeColumn
                        values={HOURS}
                        selected={date.getHours()}
                        isDisabled={isHourDisabled}
                        onSelect={handleHour}
                    />
                    <TimeColumn
                        values={MINUTES}
                        selected={date.getMinutes()}
                        isDisabled={isMinuteDisabled}
                        onSelect={handleMinute}
                    />
                </div>
            )}
        </div>
    );
});
