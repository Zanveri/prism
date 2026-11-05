import type { UiCopy } from "./ui.copy";

export const uiCopyEn: UiCopy = {
  cancel: "Cancel",
  close: "Close",
  toast: { close: "Close notice" },
  datePicker: {
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    weekdays: [
      { key: "dom", label: "S", full: "Sunday" },
      { key: "seg", label: "M", full: "Monday" },
      { key: "ter", label: "T", full: "Tuesday" },
      { key: "qua", label: "W", full: "Wednesday" },
      { key: "qui", label: "T", full: "Thursday" },
      { key: "sex", label: "F", full: "Friday" },
      { key: "sab", label: "S", full: "Saturday" },
    ],
    monthOfYear: (month: string, year: number) => `${month} ${year}`,
    selectDate: "Select date",
    selectDateTime: "Select date and time",
    previousMonth: "Previous month",
    nextMonth: "Next month",
    clear: "Clear",
    now: "Now",
    today: "Today",
    time: "Time",
    hours: "Hours",
    minutes: "Minutes",
  },
};
