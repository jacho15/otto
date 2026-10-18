import { Component, type ReactNode } from 'react'

interface Props {
  /** The boundary tries its children again when this changes. */
  resetKey: string
  /** Drawn instead of the children after they throw. */
  fallback: ReactNode
  children: ReactNode
}

/** Catches a model that fails to load or draw, so one bad file cannot take down the whole room. */
export default class ModelBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
