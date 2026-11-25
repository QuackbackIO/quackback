import { defineMessages } from 'react-intl'

/** The header's second line while the team is away, per usual reply time. */
export const headerReplyTimeMessages = defineMessages({
  minutes: {
    id: 'widget.messenger.header.replyTime.minutes',
    defaultMessage: 'Typically replies in a few minutes',
  },
  hour: {
    id: 'widget.messenger.header.replyTime.hour',
    defaultMessage: 'Typically replies in under an hour',
  },
  hours: {
    id: 'widget.messenger.header.replyTime.hours',
    defaultMessage: 'Typically replies in a few hours',
  },
  day: {
    id: 'widget.messenger.header.replyTime.day',
    defaultMessage: 'Typically replies within a day',
  },
})

/** The reply-time caption's online line, per usual reply time. */
export const captionOnlineMessages = defineMessages({
  minutes: {
    id: 'widget.messenger.replyTime.online.minutes',
    defaultMessage: "We're online, typically replies in a few minutes.",
  },
  hour: {
    id: 'widget.messenger.replyTime.online',
    defaultMessage: "We're online, typically replies in under an hour.",
  },
  hours: {
    id: 'widget.messenger.replyTime.online.hours',
    defaultMessage: "We're online, typically replies in a few hours.",
  },
  day: {
    id: 'widget.messenger.replyTime.online.day',
    defaultMessage: "We're online, typically replies within a day.",
  },
  off: { id: 'widget.messenger.replyTime.online.off', defaultMessage: "We're online." },
})
